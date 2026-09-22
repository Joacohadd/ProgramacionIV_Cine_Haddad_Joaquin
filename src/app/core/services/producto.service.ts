import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { PRODUCTOS_DEMO } from '../data/productos-demo';
import { CATEGORIA_OTROS_ID, CATEGORIAS_CANDY_DEMO } from '../data/categorias-candy-demo';
import { CategoriaCandy } from '../models/categoria-candy.interface';
import { Producto, ProductoEditable } from '../models/producto.interface';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

const DEMO_KEY = 'umbral-demo-productos';
const CATEGORIAS_DEMO_KEY = 'umbral-demo-categorias-candy';

@Injectable({ providedIn: 'root' })
export class ProductoService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly productosSignal = signal<Producto[]>([]);
  private readonly categoriasSignal = signal<CategoriaCandy[]>([]);
  private ultimaCarga = 0;
  readonly productos = computed(() => this.productosSignal());
  readonly publicados = computed(() => this.productos().filter(producto => producto.activo));
  readonly categorias = computed(() => this.categoriasSignal());
  readonly gruposPublicados = computed(() => this.categorias().map(categoria => ({
    ...categoria,
    productos: this.publicados().filter(producto => producto.categoria_id === categoria.id)
  })).filter(grupo => grupo.productos.length > 0));
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // Al cambiar el rol, volvemos a consultar con los permisos de esa sesión.
    effect(() => {
      this.auth.currentUserData()?.rol;
      untracked(() => {
        this.productosSignal.set([]);
        this.categoriasSignal.set([]);
        void this.cargar();
      });
    });
  }

  async cargar(): Promise<void> {
    const carga = ++this.ultimaCarga;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const client = this.supabase.client;
      let productos: Producto[];
      let categorias: CategoriaCandy[];
      if (client) {
        const [resultadoProductos, resultadoCategorias] = await Promise.all([
          client.from('productos_candy')
            .select('id,nombre,descripcion,categoria_id,precio_centavos,imagen_url,activo').order('nombre'),
          client.from('categorias_candy').select('id,nombre').order('nombre')
        ]);
        if (resultadoProductos.error || resultadoCategorias.error) throw new Error('No se pudo cargar el candy bar. Intentá nuevamente.');
        productos = (resultadoProductos.data ?? []) as Producto[];
        categorias = (resultadoCategorias.data ?? []) as CategoriaCandy[];
      } else {
        const esAdmin = this.auth.currentUserData()?.rol === 'admin';
        productos = this.leerDemo().filter(producto => esAdmin || producto.activo);
        categorias = this.leerCategoriasDemo();
      }
      if (carga === this.ultimaCarga) {
        this.productosSignal.set(productos.sort((a, b) => a.nombre.localeCompare(b.nombre)));
        this.categoriasSignal.set(categorias.sort((a, b) => a.nombre.localeCompare(b.nombre)));
      }
    } catch (error) {
      if (carga === this.ultimaCarga) {
        this.error.set(error instanceof Error ? error.message : 'No se pudo cargar el candy bar.');
      }
    } finally {
      if (carga === this.ultimaCarga) this.cargando.set(false);
    }
  }

  async guardar(producto: ProductoEditable, id?: string): Promise<void> {
    this.validarAdministrador();
    const normalizado = {
      ...producto, nombre: producto.nombre.trim(), descripcion: producto.descripcion.trim(),
      imagen_url: producto.imagen_url.trim()
    };
    if (normalizado.nombre.length < 2 || normalizado.nombre.length > 100) {
      throw new Error('El nombre debe tener entre 2 y 100 caracteres.');
    }
    if (normalizado.descripcion.length < 5 || normalizado.descripcion.length > 500) {
      throw new Error('La descripción debe tener entre 5 y 500 caracteres.');
    }
    if (!Number.isInteger(normalizado.precio_centavos) || normalizado.precio_centavos < 1 || normalizado.precio_centavos > 2147483647) {
      throw new Error('Ingresá un precio válido mayor a cero.');
    }
    if (normalizado.imagen_url && !/^https:\/\/\S+$/.test(normalizado.imagen_url)) {
      throw new Error('La imagen debe tener una dirección HTTPS válida.');
    }
    if (!this.categorias().some(categoria => categoria.id === normalizado.categoria_id)) {
      throw new Error('Elegí una categoría válida para el producto.');
    }

    const client = this.supabase.client;
    if (client) {
      const consulta = id
        ? client.from('productos_candy').update(normalizado).eq('id', id)
        : client.from('productos_candy').insert(normalizado);
      const { error } = await consulta.select('id').single();
      if (error) throw new Error('No se pudo guardar el producto. Verificá tu acceso e intentá nuevamente.');
    } else {
      const productos = this.leerDemo();
      if (id && !productos.some(item => item.id === id)) throw new Error('El producto ya no existe.');
      const actualizado: Producto = { ...normalizado, id: id ?? crypto.randomUUID() };
      localStorage.setItem(DEMO_KEY, JSON.stringify(id
        ? productos.map(item => item.id === id ? actualizado : item)
        : [...productos, actualizado]));
    }
    await this.cargar();
  }

  async crearCategoria(nombre: string): Promise<void> {
    this.validarAdministrador();
    const normalizado = nombre.trim().replace(/\s+/g, ' ');
    if (normalizado.length < 2 || normalizado.length > 60) {
      throw new Error('El nombre de la categoría debe tener entre 2 y 60 caracteres.');
    }
    const client = this.supabase.client;
    if (client) {
      const { error } = await client.from('categorias_candy').insert({ nombre: normalizado });
      if (error?.code === '23505') throw new Error('Ya existe una categoría con ese nombre.');
      if (error) throw new Error('No se pudo crear la categoría. Intentá nuevamente.');
    } else {
      const categorias = this.leerCategoriasDemo();
      if (categorias.some(categoria => categoria.nombre.toLocaleLowerCase() === normalizado.toLocaleLowerCase())) {
        throw new Error('Ya existe una categoría con ese nombre.');
      }
      localStorage.setItem(CATEGORIAS_DEMO_KEY, JSON.stringify([
        ...categorias, { id: crypto.randomUUID(), nombre: normalizado }
      ]));
    }
    await this.cargar();
  }

  nombreCategoria(id: string): string {
    return this.categorias().find(categoria => categoria.id === id)?.nombre ?? 'Otros';
  }

  async cambiarPublicacion(id: string, activo: boolean): Promise<void> {
    this.validarAdministrador();
    const client = this.supabase.client;
    if (client) {
      const { error } = await client.from('productos_candy').update({ activo }).eq('id', id).select('id').single();
      if (error) throw new Error('No se pudo cambiar la publicación del producto.');
    } else {
      const productos = this.leerDemo();
      if (!productos.some(item => item.id === id)) throw new Error('El producto ya no existe.');
      localStorage.setItem(DEMO_KEY, JSON.stringify(productos.map(item => item.id === id ? { ...item, activo } : item)));
    }
    await this.cargar();
  }

  private validarAdministrador(): void {
    if (this.auth.currentUserData()?.rol !== 'admin') throw new Error('Solo un administrador puede modificar los productos.');
  }

  private leerDemo(): Producto[] {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return [...PRODUCTOS_DEMO];
    try {
      // Compatibilidad con los productos guardados antes de incorporar RF-035.
      return (JSON.parse(raw) as Producto[]).map(producto => ({
        ...producto, categoria_id: producto.categoria_id || CATEGORIA_OTROS_ID
      }));
    } catch { return [...PRODUCTOS_DEMO]; }
  }

  private leerCategoriasDemo(): CategoriaCandy[] {
    const raw = localStorage.getItem(CATEGORIAS_DEMO_KEY);
    if (!raw) return [...CATEGORIAS_CANDY_DEMO];
    try { return JSON.parse(raw) as CategoriaCandy[]; } catch { return [...CATEGORIAS_CANDY_DEMO]; }
  }
}
