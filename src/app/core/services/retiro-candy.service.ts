import { inject, Injectable, signal } from '@angular/core';
import { Compra, ProductoCompra } from '../models/compra.interface';
import { RetiroCandy } from '../models/retiro-candy.interface';
import { parsearCodigoManual, parsearCodigoQr } from '../utils/codigo-qr';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

export type OperacionPersonal = 'ingreso' | 'candy';
export type ModoLectura = 'qr' | 'manual';

const DEMO_COMPRAS_KEY = 'umbral-demo-compras';
const DEMO_AUDITORIA_KEY = 'umbral-demo-auditoria';

@Injectable({ providedIn: 'root' })
export class RetiroCandyService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private ultimoCodigo: string | null = null;
  private ultimoToken: string | null = null;
  private modo: ModoLectura = 'qr';

  readonly resultado = signal<RetiroCandy | null>(null);
  readonly procesando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  limpiar(): void {
    this.resultado.set(null);
    this.error.set(null);
    this.mensaje.set(null);
    this.ultimoCodigo = null;
    this.ultimoToken = null;
  }

  async consultar(contenido: string, modo: ModoLectura): Promise<void> {
    const qr = modo === 'qr' ? parsearCodigoQr(contenido) : null;
    const codigo = modo === 'manual' ? parsearCodigoManual(contenido) : qr?.codigo ?? null;
    const token = qr?.token ?? null;
    this.limpiar();
    if (!codigo) {
      this.error.set(modo === 'qr'
        ? 'El contenido no corresponde a un QR válido de Umbral.'
        : 'Ingresá el código impreso con formato UMB-XXXXXXXXXX.');
      return;
    }
    this.procesando.set(true);
    try {
      this.validarPersonal();
      const client = this.supabase.client;
      let compra: RetiroCandy;
      if (client) {
        const { data, error } = await client.rpc('consultar_compra_personal', {
          p_codigo: codigo, p_qr_token: token
        });
        if (error) throw new Error(error.message);
        const resultado = (Array.isArray(data) ? data[0] : data) as RetiroCandy | null;
        if (!resultado) throw new Error('No se encontró una compra con ese código.');
        compra = this.normalizar(resultado);
      } else {
        compra = this.consultarDemo(codigo, token);
      }
      this.ultimoCodigo = codigo;
      this.ultimoToken = token;
      this.modo = modo;
      this.resultado.set(compra);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo consultar la compra.');
    } finally {
      this.procesando.set(false);
    }
  }

  async confirmar(operacion: OperacionPersonal): Promise<void> {
    const resultado = this.resultado();
    if (!resultado || !this.ultimoCodigo) return;
    this.procesando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      this.validarPersonal();
      const client = this.supabase.client;
      let fecha: string;
      if (client) {
        const { data, error } = await client.rpc('validar_operacion_personal', {
          p_codigo: this.ultimoCodigo,
          p_operacion: operacion,
          p_qr_token: this.ultimoToken
        });
        if (error) throw new Error(error.message);
        const registro = (Array.isArray(data) ? data[0] : data) as { validado_en: string } | null;
        if (!registro) throw new Error('No se pudo registrar la validación.');
        fecha = registro.validado_en;
      } else {
        fecha = this.confirmarDemo(operacion, resultado.compra_codigo);
      }
      this.resultado.update(actual => actual ? {
        ...actual,
        ingreso_validado_en: operacion === 'ingreso' ? fecha : actual.ingreso_validado_en,
        candy_retirado_en: operacion === 'candy' ? fecha : actual.candy_retirado_en
      } : actual);
      this.mensaje.set(operacion === 'ingreso'
        ? 'Ingreso registrado. Esta entrada ya no puede volver a validarse.'
        : 'Entrega registrada. Este pedido ya no puede volver a retirarse.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo registrar la validación.');
    } finally {
      this.procesando.set(false);
    }
  }

  private consultarDemo(codigo: string, token: string | null): RetiroCandy {
    const compra = this.leerComprasDemo().find(item => item.codigo === codigo
      && (token === null || item.qr_token === token));
    if (!compra) throw new Error('No se encontró una compra con ese código.');
    return {
      valida: compra.estado === 'pagada',
      estado: compra.estado,
      compra_codigo: compra.codigo,
      pelicula_titulo: compra.pelicula_titulo,
      fecha_funcion: compra.fecha_funcion,
      hora_inicio: compra.hora_inicio,
      sala_nombre: compra.sala_nombre,
      butacas: compra.entradas.map(entrada => entrada.butaca_codigo),
      productos: compra.productos ?? [],
      combos: compra.combos ?? [],
      ingreso_validado_en: compra.ingreso_validado_en ?? null,
      candy_retirado_en: compra.candy_retirado_en ?? null
    };
  }

  private confirmarDemo(operacion: OperacionPersonal, codigo: string): string {
    const compras = this.leerComprasDemo();
    const compra = compras.find(item => item.codigo === codigo);
    if (!compra || compra.estado !== 'pagada') throw new Error('La compra no está vigente.');
    if (operacion === 'ingreso' && compra.ingreso_validado_en) {
      throw new Error('El ingreso de esta entrada ya fue validado.');
    }
    if (operacion === 'candy') {
      if (compra.candy_retirado_en) throw new Error('El candy de esta compra ya fue entregado.');
      if (!(compra.productos ?? []).length) throw new Error('La compra no contiene productos del candy.');
    }
    const fecha = new Date().toISOString();
    localStorage.setItem(DEMO_COMPRAS_KEY, JSON.stringify(compras.map(item => item.codigo === codigo
      ? {
          ...item,
          ingreso_validado_en: operacion === 'ingreso' ? fecha : item.ingreso_validado_en ?? null,
          candy_retirado_en: operacion === 'candy' ? fecha : item.candy_retirado_en ?? null
        }
      : item)));
    this.registrarAuditoriaDemo(operacion, codigo);
    return fecha;
  }

  private registrarAuditoriaDemo(operacion: OperacionPersonal, codigo: string): void {
    const perfil = this.auth.currentUserData();
    const raw = localStorage.getItem(DEMO_AUDITORIA_KEY);
    let registros: unknown[] = [];
    try { registros = raw ? JSON.parse(raw) as unknown[] : []; } catch { /* Se inicia un registro nuevo. */ }
    registros.unshift({
      id: crypto.randomUUID(),
      usuario_id: perfil?.id ?? null,
      usuario_email: perfil?.email ?? 'sistema',
      accion: operacion === 'ingreso' ? 'ingreso_validado' : 'candy_entregado',
      entidad: 'compras',
      entidad_id: codigo,
      detalle: { codigo, medio: this.modo },
      creado_en: new Date().toISOString()
    });
    localStorage.setItem(DEMO_AUDITORIA_KEY, JSON.stringify(registros));
  }

  private normalizar(resultado: RetiroCandy): RetiroCandy {
    return {
      ...resultado,
      butacas: Array.isArray(resultado.butacas) ? resultado.butacas : [],
      productos: Array.isArray(resultado.productos)
        ? resultado.productos.map((producto: ProductoCompra) => ({
            ...producto,
            cantidad: Number(producto.cantidad),
            precio_unitario_centavos: Number(producto.precio_unitario_centavos),
            subtotal_centavos: Number(producto.subtotal_centavos)
          }))
        : [],
      combos: Array.isArray(resultado.combos) ? resultado.combos : [],
      ingreso_validado_en: resultado.ingreso_validado_en ?? null,
      candy_retirado_en: resultado.candy_retirado_en ?? null
    };
  }

  private leerComprasDemo(): Compra[] {
    const raw = localStorage.getItem(DEMO_COMPRAS_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as Compra[]; } catch { return []; }
  }

  private validarPersonal(): void {
    const rol = this.auth.currentUserData()?.rol;
    if (rol !== 'admin' && rol !== 'empleado') {
      throw new Error('Solo el personal del cine puede validar entradas y pedidos.');
    }
  }
}
