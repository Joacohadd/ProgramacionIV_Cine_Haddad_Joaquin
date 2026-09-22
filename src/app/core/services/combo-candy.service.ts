import { computed, inject, Injectable, signal } from '@angular/core';
import { COMBOS_CANDY_DEMO } from '../data/combos-candy-demo';
import { ComboCandy, ComboCandyEditable } from '../models/combo-candy.interface';
import { AuthService } from './auth.service';
import { ProductoService } from './producto.service';
import { SupabaseService } from './supabase.service';

const COMBOS_DEMO_KEY = 'umbral-demo-combos-candy';

@Injectable({ providedIn: 'root' })
export class ComboCandyService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  readonly productos = inject(ProductoService);
  private readonly combosSignal = signal<ComboCandy[]>([]);
  private ultimaCarga = 0;

  readonly combos = computed(() => this.combosSignal());
  readonly publicados = computed(() => {
    const productosActivos = new Set(this.productos.publicados().map(producto => producto.id));
    return this.combos().filter(combo => combo.activo
      && productosActivos.has(combo.pochoclos_producto_id)
      && productosActivos.has(combo.bebida_producto_id));
  });
  readonly productosPochoclos = computed(() => this.productos.productos().filter(producto =>
    this.productos.nombreCategoria(producto.categoria_id).toLocaleLowerCase().includes('pochoclo')));
  readonly productosBebidas = computed(() => this.productos.productos().filter(producto =>
    this.productos.nombreCategoria(producto.categoria_id).toLocaleLowerCase().includes('bebida')));
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  async cargar(): Promise<void> {
    const carga = ++this.ultimaCarga;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const client = this.supabase.client;
      const combos = client
        ? await this.cargarSupabase()
        : this.leerDemo().filter(combo => this.auth.currentUserData()?.rol === 'admin' || combo.activo);
      if (carga === this.ultimaCarga) {
        this.combosSignal.set(combos.sort((a, b) => a.nombre.localeCompare(b.nombre)));
      }
    } catch (error) {
      if (carga === this.ultimaCarga) {
        this.error.set(error instanceof Error ? error.message : 'No se pudieron cargar los combos.');
      }
    } finally {
      if (carga === this.ultimaCarga) this.cargando.set(false);
    }
  }

  async guardar(combo: ComboCandyEditable, id?: string): Promise<void> {
    this.validarAdministrador();
    const normalizado: ComboCandyEditable = {
      ...combo,
      nombre: combo.nombre.trim().replace(/\s+/g, ' '),
      descripcion: combo.descripcion.trim().replace(/\s+/g, ' ')
    };
    if (normalizado.nombre.length < 2 || normalizado.nombre.length > 100) {
      throw new Error('El nombre debe tener entre 2 y 100 caracteres.');
    }
    if (normalizado.descripcion.length < 5 || normalizado.descripcion.length > 300) {
      throw new Error('La descripción debe tener entre 5 y 300 caracteres.');
    }
    if (!Number.isInteger(normalizado.precio_centavos) || normalizado.precio_centavos < 1 || normalizado.precio_centavos > 2147483647) {
      throw new Error('Ingresá un precio fijo válido mayor a cero.');
    }
    if (!this.productosPochoclos().some(producto => producto.id === normalizado.pochoclos_producto_id)) {
      throw new Error('Elegí un producto de la categoría Pochoclos.');
    }
    if (!this.productosBebidas().some(producto => producto.id === normalizado.bebida_producto_id)) {
      throw new Error('Elegí un producto de la categoría Bebidas.');
    }

    const client = this.supabase.client;
    if (client) {
      const consulta = id
        ? client.from('combos_candy').update(normalizado).eq('id', id)
        : client.from('combos_candy').insert(normalizado);
      const { error } = await consulta.select('id').single();
      if (error) throw new Error('No se pudo guardar el combo. Verificá los productos elegidos.');
    } else {
      const combos = this.leerDemo();
      if (id && !combos.some(item => item.id === id)) throw new Error('El combo ya no existe.');
      const actualizado: ComboCandy = { ...normalizado, id: id ?? crypto.randomUUID() };
      localStorage.setItem(COMBOS_DEMO_KEY, JSON.stringify(id
        ? combos.map(item => item.id === id ? actualizado : item)
        : [...combos, actualizado]));
    }
    await this.cargar();
  }

  async cambiarPublicacion(id: string, activo: boolean): Promise<void> {
    this.validarAdministrador();
    const client = this.supabase.client;
    if (client) {
      const { error } = await client.from('combos_candy').update({ activo }).eq('id', id).select('id').single();
      if (error) throw new Error('No se pudo cambiar la publicación del combo.');
    } else {
      const combos = this.leerDemo();
      if (!combos.some(item => item.id === id)) throw new Error('El combo ya no existe.');
      localStorage.setItem(COMBOS_DEMO_KEY, JSON.stringify(combos.map(item => item.id === id ? { ...item, activo } : item)));
    }
    await this.cargar();
  }

  nombreProducto(id: string): string {
    return this.productos.productos().find(producto => producto.id === id)?.nombre ?? 'Producto no disponible';
  }

  private async cargarSupabase(): Promise<ComboCandy[]> {
    const client = this.supabase.client;
    if (!client) return [];
    const { data, error } = await client.from('combos_candy')
      .select('id,nombre,descripcion,pochoclos_producto_id,bebida_producto_id,precio_centavos,activo')
      .order('nombre');
    if (error) throw new Error('No se pudieron cargar los combos. Aplicá la migración final del punto 4.7.');
    return (data ?? []) as ComboCandy[];
  }

  private validarAdministrador(): void {
    if (this.auth.currentUserData()?.rol !== 'admin') throw new Error('Solo un administrador puede modificar los combos.');
  }

  private leerDemo(): ComboCandy[] {
    const raw = localStorage.getItem(COMBOS_DEMO_KEY);
    if (!raw) return [...COMBOS_CANDY_DEMO];
    try { return JSON.parse(raw) as ComboCandy[]; } catch { return [...COMBOS_CANDY_DEMO]; }
  }
}
