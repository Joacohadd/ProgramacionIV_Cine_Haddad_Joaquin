import { computed, inject, Injectable, signal } from '@angular/core';
import { Cupon, CuponEditable } from '../models/cupon.interface';
import { esMayorDeCincuenta } from '../utils/cupones';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

const CUPONES_DEMO_KEY = 'umbral-demo-cupones';
const COMPRAS_DEMO_KEY = 'umbral-demo-compras';
const CUPON_PRIMERA_COMPRA_ID = 'd1000000-0000-4000-8000-000000000001';
const CUPONES_INICIALES: Cupon[] = [{
  id: CUPON_PRIMERA_COMPRA_ID,
  codigo: 'PRIMERA20',
  nombre: 'Primera compra',
  tipo: 'primera_compra',
  porcentaje: 20,
  activo: true
}];

@Injectable({ providedIn: 'root' })
export class CuponService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly todosSignal = signal<Cupon[]>([]);
  private readonly disponiblesSignal = signal<Cupon[]>([]);

  readonly todos = computed(() => this.todosSignal());
  readonly disponibles = computed(() => this.disponiblesSignal());
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  async cargarAdministracion(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const client = this.supabase.client;
      if (!client) {
        this.todosSignal.set(this.leerDemo().sort((a, b) => a.nombre.localeCompare(b.nombre)));
        return;
      }
      const { data, error } = await client.from('cupones')
        .select('id,codigo,nombre,tipo,porcentaje,activo')
        .order('tipo').order('nombre');
      if (error) throw new Error('No se pudieron cargar los cupones. Aplicá la migración del punto 4.8.');
      this.todosSignal.set((data ?? []) as Cupon[]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudieron cargar los cupones.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarDisponibles(): Promise<void> {
    const perfil = this.auth.currentUserData();
    this.error.set(null);
    if (!perfil) {
      this.disponiblesSignal.set([]);
      return;
    }

    try {
      const client = this.supabase.client;
      if (client) {
        const { data, error } = await client.rpc('cupones_disponibles');
        if (error) throw new Error('No se pudieron consultar tus cupones. Aplicá la migración del punto 4.8.');
        this.disponiblesSignal.set((data ?? []) as Cupon[]);
        return;
      }

      const compras = this.leerComprasDemo();
      const yaCompro = compras.some(compra => compra?.usuario_id === perfil.id);
      const hoy = new Date().toISOString().slice(0, 10);
      this.disponiblesSignal.set(this.leerDemo().filter(cupon => cupon.activo && (
        (cupon.tipo === 'primera_compra' && !yaCompro)
        || (cupon.tipo === 'mayores_50' && esMayorDeCincuenta(perfil.fecha_nacimiento, hoy))
      )));
    } catch (error) {
      this.disponiblesSignal.set([]);
      this.error.set(error instanceof Error ? error.message : 'No se pudieron consultar tus cupones.');
    }
  }

  async guardar(cupon: CuponEditable, id?: string): Promise<void> {
    this.validarAdministrador();
    const normalizado: CuponEditable = {
      codigo: cupon.codigo.trim().toUpperCase(),
      nombre: cupon.nombre.trim().replace(/\s+/g, ' '),
      tipo: cupon.tipo,
      porcentaje: Number(cupon.porcentaje),
      activo: cupon.activo
    };
    this.validar(normalizado);

    const client = this.supabase.client;
    if (client) {
      const consulta = id
        ? client.from('cupones').update(normalizado).eq('id', id)
        : client.from('cupones').insert(normalizado);
      const { error } = await consulta.select('id').single();
      if (error) throw new Error(error.code === '23505' ? 'Ya existe un cupón con ese código.' : 'No se pudo guardar el cupón.');
    } else {
      const cupones = this.leerDemo();
      if (id && !cupones.some(item => item.id === id)) throw new Error('El cupón ya no existe.');
      if (cupones.some(item => item.codigo === normalizado.codigo && item.id !== id)) throw new Error('Ya existe un cupón con ese código.');
      const actualizado: Cupon = { ...normalizado, id: id ?? crypto.randomUUID() };
      localStorage.setItem(CUPONES_DEMO_KEY, JSON.stringify(id
        ? cupones.map(item => item.id === id ? actualizado : item)
        : [...cupones, actualizado]));
    }
    await this.cargarAdministracion();
  }

  async configurarPrimeraCompra(porcentaje: number, activo: boolean): Promise<void> {
    const cupon = this.todos().find(item => item.tipo === 'primera_compra');
    if (!cupon) throw new Error('No se encontró el cupón de primera compra.');
    await this.guardar({
      codigo: cupon.codigo,
      nombre: cupon.nombre,
      tipo: 'primera_compra',
      porcentaje,
      activo
    }, cupon.id);
  }

  obtenerDisponible(id: string): Cupon | undefined {
    return this.disponibles().find(cupon => cupon.id === id);
  }

  private validar(cupon: CuponEditable): void {
    if (!/^[A-Z0-9_-]{4,24}$/.test(cupon.codigo)) throw new Error('El código debe tener entre 4 y 24 letras, números, guiones o guiones bajos.');
    if (cupon.nombre.length < 2 || cupon.nombre.length > 100) throw new Error('El nombre debe tener entre 2 y 100 caracteres.');
    if (!Number.isInteger(cupon.porcentaje) || cupon.porcentaje < 1 || cupon.porcentaje > 99) {
      throw new Error('El porcentaje debe ser un número entero entre 1 y 99.');
    }
    if (cupon.tipo !== 'primera_compra' && cupon.tipo !== 'mayores_50') throw new Error('El tipo de cupón no es válido.');
  }

  private validarAdministrador(): void {
    if (this.auth.currentUserData()?.rol !== 'admin') throw new Error('Solo un administrador puede modificar los cupones.');
  }

  private leerDemo(): Cupon[] {
    if (typeof localStorage === 'undefined') return [...CUPONES_INICIALES];
    const raw = localStorage.getItem(CUPONES_DEMO_KEY);
    if (!raw) return [...CUPONES_INICIALES];
    try { return JSON.parse(raw) as Cupon[]; } catch { return [...CUPONES_INICIALES]; }
  }

  private leerComprasDemo(): Array<{ usuario_id?: string | null }> {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(COMPRAS_DEMO_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as Array<{ usuario_id?: string | null }>; } catch { return []; }
  }
}
