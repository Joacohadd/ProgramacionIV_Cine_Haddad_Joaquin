import { computed, inject, Injectable, signal } from '@angular/core';
import { CanjeRecompensa, Recompensa, RecompensaEditable, ResultadoCanjeRpc } from '../models/recompensa.interface';
import { AuthService } from './auth.service';
import { ProductoService } from './producto.service';
import { SupabaseService } from './supabase.service';

const RECOMPENSAS_DEMO_KEY = 'umbral-demo-recompensas';
const CANJES_DEMO_KEY = 'umbral-demo-canjes';
const RECOMPENSAS_INICIALES: Recompensa[] = [
  {
    id: 'demo-recompensa-entrada', nombre: 'Entrada gratis',
    descripcion: 'Canjeá tus puntos por una entrada general sin cargo.',
    tipo: 'entrada', producto_id: null, costo_puntos: 500, activo: true
  },
  {
    id: 'demo-recompensa-pochoclos', nombre: 'Pochoclos grandes',
    descripcion: 'Un balde de pochoclos grandes para retirar en el candy bar.',
    tipo: 'producto', producto_id: 'demo-producto-1', costo_puntos: 150, activo: true
  }
];

@Injectable({ providedIn: 'root' })
export class FidelizacionService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  readonly productos = inject(ProductoService);
  private readonly recompensasSignal = signal<Recompensa[]>([]);
  private readonly canjesSignal = signal<CanjeRecompensa[]>([]);

  readonly recompensas = computed(() => this.recompensasSignal());
  readonly canjes = computed(() => this.canjesSignal());
  readonly cargando = signal(false);
  readonly procesando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  async cargarAdministracion(): Promise<void> {
    await this.cargar(true);
  }

  async cargarPerfil(): Promise<void> {
    if (!this.auth.currentUserData()) {
      this.recompensasSignal.set([]);
      this.canjesSignal.set([]);
      return;
    }
    await this.cargar(false);
  }

  async guardar(recompensa: RecompensaEditable, id?: string): Promise<void> {
    this.validarAdministrador();
    const normalizada: RecompensaEditable = {
      nombre: recompensa.nombre.trim().replace(/\s+/g, ' '),
      descripcion: recompensa.descripcion.trim().replace(/\s+/g, ' '),
      tipo: recompensa.tipo,
      producto_id: recompensa.tipo === 'producto' ? recompensa.producto_id : null,
      costo_puntos: Number(recompensa.costo_puntos),
      activo: recompensa.activo
    };
    this.validar(normalizada);

    const client = this.supabase.client;
    if (client) {
      const consulta = id
        ? client.from('recompensas_fidelizacion').update(normalizada).eq('id', id)
        : client.from('recompensas_fidelizacion').insert(normalizada);
      const { error } = await consulta.select('id').single();
      if (error) throw new Error('No se pudo guardar la recompensa. Verificá los datos ingresados.');
    } else {
      const recompensas = this.leerRecompensasDemo();
      if (id && !recompensas.some(item => item.id === id)) throw new Error('La recompensa ya no existe.');
      const actualizada: Recompensa = { ...normalizada, id: id ?? crypto.randomUUID() };
      localStorage.setItem(RECOMPENSAS_DEMO_KEY, JSON.stringify(id
        ? recompensas.map(item => item.id === id ? actualizada : item)
        : [...recompensas, actualizada]));
    }
    await this.cargarAdministracion();
  }

  async canjear(recompensa: Recompensa): Promise<void> {
    const perfil = this.auth.currentUserData();
    if (!perfil) throw new Error('Iniciá sesión para canjear una recompensa.');
    if (this.procesando()) return;
    this.procesando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      const client = this.supabase.client;
      if (client) {
        const { data, error } = await client.rpc('canjear_recompensa', { p_recompensa_id: recompensa.id });
        if (error) throw new Error(error.message);
        const resultado = (Array.isArray(data) ? data[0] : data) as ResultadoCanjeRpc | null;
        if (!resultado) throw new Error('No se pudo registrar el canje.');
        await this.auth.recargarPerfil();
      } else {
        this.canjearDemo(recompensa);
      }
      await this.cargarPerfil();
      this.mensaje.set(`Canje confirmado: ${recompensa.nombre}. El código quedó guardado en tu historial.`);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo completar el canje.';
      this.error.set(mensaje);
      throw new Error(mensaje);
    } finally {
      this.procesando.set(false);
    }
  }

  nombreProducto(id: string | null): string {
    if (!id) return 'No corresponde';
    return this.productos.productos().find(producto => producto.id === id)?.nombre ?? 'Producto no disponible';
  }

  private async cargar(esAdministracion: boolean): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      await this.productos.cargar();
      const client = this.supabase.client;
      if (client) {
        const recompensasQuery = client.from('recompensas_fidelizacion')
          .select('id,nombre,descripcion,tipo,producto_id,costo_puntos,activo').order('costo_puntos');
        const [resultadoRecompensas, resultadoCanjes] = await Promise.all([
          esAdministracion ? recompensasQuery : recompensasQuery.eq('activo', true),
          esAdministracion
            ? Promise.resolve({ data: [], error: null })
            : client.from('canjes_recompensas').select('*').order('creado_en', { ascending: false })
        ]);
        if (resultadoRecompensas.error || resultadoCanjes.error) {
          throw new Error('No se pudo cargar el programa de puntos. Aplicá la migración del punto 4.9.');
        }
        const recompensas = (resultadoRecompensas.data ?? []).map(item => this.normalizarRecompensa(item as Recompensa));
        this.recompensasSignal.set(esAdministracion ? recompensas : recompensas.filter(recompensa =>
          recompensa.tipo === 'entrada' || this.productos.publicados().some(producto => producto.id === recompensa.producto_id)));
        this.canjesSignal.set((resultadoCanjes.data ?? []).map(item => this.normalizarCanje(item as CanjeRecompensa)));
      } else {
        const recompensas = this.leerRecompensasDemo();
        this.recompensasSignal.set((esAdministracion ? recompensas : recompensas.filter(item => item.activo))
          .sort((a, b) => a.costo_puntos - b.costo_puntos));
        this.canjesSignal.set(esAdministracion ? [] : this.leerCanjesDemo()
          .filter(canje => canje.usuario_id === this.auth.currentUserData()?.id)
          .sort((a, b) => b.creado_en.localeCompare(a.creado_en)));
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo cargar el programa de puntos.');
    } finally {
      this.cargando.set(false);
    }
  }

  private canjearDemo(recompensa: Recompensa): void {
    const perfil = this.auth.currentUserData();
    const disponible = this.leerRecompensasDemo().find(item => item.id === recompensa.id && item.activo);
    if (!perfil || !disponible) throw new Error('La recompensa ya no está disponible.');
    if (disponible.tipo === 'producto' && !this.productos.publicados().some(producto => producto.id === disponible.producto_id)) {
      throw new Error('El producto asociado ya no está disponible.');
    }
    if (perfil.puntos < disponible.costo_puntos) throw new Error('No tenés puntos suficientes para esta recompensa.');

    const canje: CanjeRecompensa & { usuario_id: string } = {
      id: crypto.randomUUID(),
      codigo: `CAN-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
      usuario_id: perfil.id,
      recompensa_id: disponible.id,
      recompensa_nombre: disponible.nombre,
      recompensa_descripcion: disponible.descripcion,
      tipo: disponible.tipo,
      producto_id: disponible.producto_id,
      producto_nombre: disponible.tipo === 'producto' ? this.nombreProducto(disponible.producto_id) : null,
      costo_puntos: disponible.costo_puntos,
      creado_en: new Date().toISOString()
    };
    localStorage.setItem(CANJES_DEMO_KEY, JSON.stringify([...this.leerCanjesDemo(), canje]));
    this.auth.actualizarPuntosDemo(perfil.puntos - disponible.costo_puntos);
  }

  private validar(recompensa: RecompensaEditable): void {
    if (recompensa.nombre.length < 2 || recompensa.nombre.length > 100) throw new Error('El nombre debe tener entre 2 y 100 caracteres.');
    if (recompensa.descripcion.length < 5 || recompensa.descripcion.length > 300) throw new Error('La descripción debe tener entre 5 y 300 caracteres.');
    if (!Number.isInteger(recompensa.costo_puntos) || recompensa.costo_puntos < 1) throw new Error('El costo debe ser un número entero mayor a cero.');
    if (recompensa.tipo !== 'entrada' && recompensa.tipo !== 'producto') throw new Error('Elegí un tipo de recompensa válido.');
    if (recompensa.tipo === 'producto' && !this.productos.productos().some(producto => producto.id === recompensa.producto_id)) {
      throw new Error('Elegí un producto válido del candy bar.');
    }
  }

  private validarAdministrador(): void {
    if (this.auth.currentUserData()?.rol !== 'admin') throw new Error('Solo un administrador puede modificar las recompensas.');
  }

  private normalizarRecompensa(recompensa: Recompensa): Recompensa {
    return { ...recompensa, costo_puntos: Number(recompensa.costo_puntos) };
  }

  private normalizarCanje(canje: CanjeRecompensa): CanjeRecompensa {
    return { ...canje, costo_puntos: Number(canje.costo_puntos) };
  }

  private leerRecompensasDemo(): Recompensa[] {
    if (typeof localStorage === 'undefined') return [...RECOMPENSAS_INICIALES];
    const raw = localStorage.getItem(RECOMPENSAS_DEMO_KEY);
    if (!raw) return [...RECOMPENSAS_INICIALES];
    try { return JSON.parse(raw) as Recompensa[]; } catch { return [...RECOMPENSAS_INICIALES]; }
  }

  private leerCanjesDemo(): Array<CanjeRecompensa & { usuario_id: string }> {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CANJES_DEMO_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as Array<CanjeRecompensa & { usuario_id: string }>; } catch { return []; }
  }
}
