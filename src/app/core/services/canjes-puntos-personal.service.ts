import { inject, Injectable, signal } from '@angular/core';
import { CanjePuntosPersonal, CanjeRecompensa } from '../models/recompensa.interface';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

const CANJES_DEMO_KEY = 'umbral-demo-canjes';

type CanjeDemo = CanjeRecompensa & { usuario_id: string; usuario_email?: string };

@Injectable({ providedIn: 'root' })
export class CanjesPuntosPersonalService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);

  readonly resultado = signal<CanjePuntosPersonal | null>(null);
  readonly recientes = signal<CanjePuntosPersonal[]>([]);
  readonly procesando = signal(false);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  limpiar(): void {
    this.resultado.set(null);
    this.error.set(null);
    this.mensaje.set(null);
  }

  async cargarRecientes(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.validarPersonal();
      const client = this.supabase.client;
      if (client) {
        const { data, error } = await client.rpc('listar_canjes_puntos_personal');
        if (error) throw new Error(error.code === 'PGRST202'
          ? 'Falta aplicar la migración de canjes en compras en Supabase.' : error.message);
        this.recientes.set((Array.isArray(data) ? data : []).map(item => this.normalizar(item as CanjePuntosPersonal)));
      } else {
        this.recientes.set(this.leerDemo().sort((a, b) => b.creado_en.localeCompare(a.creado_en))
          .slice(0, 50).map(canje => this.desdeDemo(canje)));
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudieron cargar los canjes.');
    } finally {
      this.cargando.set(false);
    }
  }

  async consultar(codigo: string): Promise<void> {
    this.limpiar();
    this.procesando.set(true);
    try {
      this.validarPersonal();
      const normalizado = this.normalizarCodigo(codigo);
      const client = this.supabase.client;
      if (client) {
        const { data, error } = await client.rpc('consultar_canje_puntos_personal', { p_codigo: normalizado });
        if (error) throw new Error(error.code === 'PGRST202'
          ? 'Falta aplicar la migración de canjes en compras en Supabase.' : error.message);
        if (!data) throw new Error('No se encontró un canje con ese código.');
        this.resultado.set(this.normalizar(data as CanjePuntosPersonal));
      } else {
        const canje = this.leerDemo().find(item => item.codigo === normalizado);
        if (!canje) throw new Error('No se encontró un canje con ese código.');
        this.resultado.set(this.desdeDemo(canje));
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo consultar el canje.');
    } finally {
      this.procesando.set(false);
    }
  }

  private normalizarCodigo(codigo: string): string {
    const valor = codigo.trim().toUpperCase();
    if (!/^CAN-[A-Z0-9]{10}$/.test(valor)) throw new Error('Ingresá un código con formato CAN-XXXXXXXXXX.');
    return valor;
  }

  private validarPersonal(): void {
    const rol = this.auth.currentUserData()?.rol;
    if (rol !== 'admin' && rol !== 'empleado') throw new Error('Solo el personal del cine puede consultar canjes.');
  }

  private normalizar(canje: CanjePuntosPersonal): CanjePuntosPersonal {
    return { ...canje, costo_puntos: Number(canje.costo_puntos), entregado_en: canje.entregado_en ?? null, compra_codigo: canje.compra_codigo ?? null };
  }

  private desdeDemo(canje: CanjeDemo): CanjePuntosPersonal {
    return this.normalizar({
      id: canje.id, codigo: canje.codigo, usuario_email: canje.usuario_email ?? 'Cuenta de muestra',
      recompensa_nombre: canje.recompensa_nombre, recompensa_descripcion: canje.recompensa_descripcion,
      tipo: canje.tipo, producto_nombre: canje.producto_nombre, costo_puntos: canje.costo_puntos,
      creado_en: canje.creado_en, entregado_en: canje.entregado_en ?? null, compra_codigo: canje.compra_codigo ?? null
    });
  }

  private leerDemo(): CanjeDemo[] {
    const raw = localStorage.getItem(CANJES_DEMO_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as CanjeDemo[]; } catch { return []; }
  }
}
