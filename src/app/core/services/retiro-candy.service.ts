import { Injectable, inject, signal } from '@angular/core';
import { Compra, ProductoCompra } from '../models/compra.interface';
import { RetiroCandy } from '../models/retiro-candy.interface';
import { parsearCodigoQr } from '../utils/codigo-qr';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

const DEMO_COMPRAS_KEY = 'umbral-demo-compras';

@Injectable({ providedIn: 'root' })
export class RetiroCandyService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  readonly resultado = signal<RetiroCandy | null>(null);
  readonly procesando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  async consultar(contenido: string): Promise<void> {
    const codigo = parsearCodigoQr(contenido);
    this.ultimoToken = codigo?.token ?? null;
    this.resultado.set(null);
    this.error.set(null);
    this.mensaje.set(null);
    if (!codigo) {
      this.error.set('El contenido no corresponde a un QR válido de Umbral.');
      return;
    }
    this.procesando.set(true);
    try {
      const client = this.supabase.client;
      if (client) {
        const { data, error } = await client.rpc('validar_entrada_qr', {
          p_codigo: codigo.codigo, p_qr_token: codigo.token
        });
        if (error) throw new Error(error.message);
        const resultado = (Array.isArray(data) ? data[0] : data) as RetiroCandy | null;
        if (!resultado) throw new Error('No se encontró una compra para ese QR.');
        this.resultado.set(this.normalizar(resultado));
      } else {
        this.resultado.set(this.consultarDemo(codigo.codigo, codigo.token));
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo consultar la compra.');
    } finally { this.procesando.set(false); }
  }

  async confirmarRetiro(): Promise<void> {
    const resultado = this.resultado();
    if (!resultado || resultado.candy_retirado_en || !resultado.productos.length) return;
    this.procesando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      const client = this.supabase.client;
      if (client) {
        const token = this.ultimoToken;
        if (!token) throw new Error('Volvé a leer el QR antes de confirmar.');
        const { data, error } = await client.rpc('retirar_candy', {
          p_codigo: resultado.compra_codigo, p_qr_token: token
        });
        if (error) throw new Error(error.message);
        const retiro = (Array.isArray(data) ? data[0] : data) as { retirado_en: string } | null;
        if (!retiro) throw new Error('No se pudo registrar el retiro.');
        this.resultado.update(actual => actual ? { ...actual, candy_retirado_en: retiro.retirado_en } : actual);
      } else {
        this.retirarDemo(resultado.compra_codigo);
      }
      this.mensaje.set('Entrega registrada. El candy de esta compra ya fue retirado.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo registrar la entrega.');
    } finally { this.procesando.set(false); }
  }

  private ultimoToken: string | null = null;

  private consultarDemo(codigo: string, token: string): RetiroCandy {
    this.validarPersonal();
    const compra = this.leerComprasDemo().find(item => item.codigo === codigo && item.qr_token === token);
    if (!compra) throw new Error('No se encontró una compra para ese QR.');
    return {
      valida: compra.estado === 'pagada', estado: compra.estado, compra_codigo: compra.codigo,
      pelicula_titulo: compra.pelicula_titulo, fecha_funcion: compra.fecha_funcion,
      hora_inicio: compra.hora_inicio, sala_nombre: compra.sala_nombre,
      productos: compra.productos ?? [], combos: compra.combos ?? [],
      candy_retirado_en: compra.candy_retirado_en ?? null
    };
  }

  private retirarDemo(codigo: string): void {
    this.validarPersonal();
    const compras = this.leerComprasDemo();
    const compra = compras.find(item => item.codigo === codigo);
    if (!compra || compra.estado !== 'pagada') throw new Error('La compra no está vigente.');
    if (!(compra.productos ?? []).length) throw new Error('La compra no contiene productos del candy.');
    if (compra.candy_retirado_en) throw new Error('El candy de esta compra ya fue retirado.');
    const retiradoEn = new Date().toISOString();
    localStorage.setItem(DEMO_COMPRAS_KEY, JSON.stringify(compras.map(item => item.codigo === codigo
      ? { ...item, candy_retirado_en: retiradoEn }
      : item)));
    this.resultado.update(actual => actual ? { ...actual, candy_retirado_en: retiradoEn } : actual);
  }

  private normalizar(resultado: RetiroCandy): RetiroCandy {
    return {
      ...resultado,
      productos: Array.isArray(resultado.productos) ? resultado.productos.map((producto: ProductoCompra) => ({
        ...producto, cantidad: Number(producto.cantidad),
        precio_unitario_centavos: Number(producto.precio_unitario_centavos),
        subtotal_centavos: Number(producto.subtotal_centavos)
      })) : [],
      combos: Array.isArray(resultado.combos) ? resultado.combos : []
    };
  }

  private leerComprasDemo(): Compra[] {
    const raw = localStorage.getItem(DEMO_COMPRAS_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as Compra[]; } catch { return []; }
  }

  private validarPersonal(): void {
    const rol = this.auth.currentUserData()?.rol;
    if (rol !== 'admin' && rol !== 'empleado') throw new Error('Solo el personal puede registrar retiros.');
  }
}
