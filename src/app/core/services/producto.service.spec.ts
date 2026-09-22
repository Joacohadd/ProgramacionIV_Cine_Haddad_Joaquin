import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATEGORIA_OTROS_ID } from '../data/categorias-candy-demo';
import { Perfil } from '../models/perfil.interface';
import { ProductoEditable } from '../models/producto.interface';
import { AuthService } from './auth.service';
import { ProductoService } from './producto.service';
import { SupabaseService } from './supabase.service';

const DEMO_KEY = 'umbral-demo-productos';
const CATEGORIAS_DEMO_KEY = 'umbral-demo-categorias-candy';
const perfil: Perfil = {
  id: 'admin-prueba', email: 'admin@ejemplo.com', nombre: 'Admin', apellido: 'Prueba',
  fecha_nacimiento: '1990-01-01', tipo_sangre: 'O+', color_ojos: 'Marrón',
  dias_vacaciones: 14, rol: 'admin', puntos: 0, credito_centavos: 0
};
const producto: ProductoEditable = {
  nombre: 'Pochoclos salados', descripcion: 'Balde mediano de pochoclos salados.',
  categoria_id: 'c1000000-0000-4000-8000-000000000001',
  precio_centavos: 425050, imagen_url: '', activo: true
};

describe('gestión de productos del candy bar', () => {
  const currentUserData = signal<Perfil | null>(null);
  let servicio: ProductoService;

  beforeEach(async () => {
    localStorage.removeItem(DEMO_KEY);
    localStorage.removeItem(CATEGORIAS_DEMO_KEY);
    currentUserData.set(perfil);
    TestBed.configureTestingModule({ providers: [
      { provide: SupabaseService, useValue: { client: null } },
      { provide: AuthService, useValue: { currentUserData } }
    ] });
    servicio = TestBed.inject(ProductoService);
    TestBed.tick();
    await servicio.cargar();
  });

  afterEach(() => {
    localStorage.removeItem(DEMO_KEY);
    localStorage.removeItem(CATEGORIAS_DEMO_KEY);
    TestBed.resetTestingModule();
  });

  it('conserva el alta y la edición al volver a cargar, con el precio en centavos', async () => {
    await servicio.guardar({ ...producto, nombre: '  Pochoclos salados  ' });
    const creado = servicio.productos().find(item => item.nombre === producto.nombre)!;
    await servicio.guardar({ ...producto, precio_centavos: 450075 }, creado.id);
    await servicio.cargar();
    expect(servicio.productos().find(item => item.id === creado.id)?.precio_centavos).toBe(450075);
    expect(servicio.productos().filter(item => item.nombre === producto.nombre)).toHaveLength(1);
  });

  it('permite ocultar y volver a ofrecer un producto sin perder sus datos', async () => {
    await servicio.guardar({ ...producto, activo: false });
    const creado = servicio.productos().find(item => item.nombre === producto.nombre)!;
    expect(servicio.publicados().some(item => item.id === creado.id)).toBe(false);
    await servicio.cambiarPublicacion(creado.id, true);
    expect(servicio.publicados().find(item => item.id === creado.id)?.descripcion).toBe(producto.descripcion);
  });

  it('excluye productos ocultos y bloquea modificaciones al salir de la cuenta administradora', async () => {
    await servicio.guardar({ ...producto, activo: false });
    const oculto = servicio.productos().find(item => item.nombre === producto.nombre)!;
    currentUserData.set(null);
    TestBed.tick();
    await servicio.cargar();
    expect(servicio.productos().some(item => item.id === oculto.id)).toBe(false);
    await expect(servicio.guardar(producto)).rejects.toThrow('Solo un administrador');
    await expect(servicio.cambiarPublicacion(oculto.id, true)).rejects.toThrow('Solo un administrador');
    currentUserData.set({ ...perfil, rol: 'cliente' });
    await expect(servicio.guardar(producto)).rejects.toThrow('Solo un administrador');
  });

  it('rechaza importes inválidos y nombres vacíos sin persistir el producto', async () => {
    const cantidad = servicio.productos().length;
    await expect(servicio.guardar({ ...producto, precio_centavos: 0 })).rejects.toThrow('precio válido');
    await expect(servicio.guardar({ ...producto, precio_centavos: 10.5 })).rejects.toThrow('precio válido');
    await expect(servicio.guardar({ ...producto, nombre: '   ' })).rejects.toThrow('nombre');
    expect(servicio.productos()).toHaveLength(cantidad);
    expect(localStorage.getItem(DEMO_KEY)).toBeNull();
  });

  it('conserva la categoría al recargar y reagrupa el producto al editarla', async () => {
    await servicio.guardar(producto);
    const creado = servicio.productos().find(item => item.nombre === producto.nombre)!;
    expect(servicio.gruposPublicados().find(grupo => grupo.nombre === 'Pochoclos')?.productos.some(item => item.id === creado.id)).toBe(true);

    const golosinas = servicio.categorias().find(categoria => categoria.nombre === 'Golosinas')!;
    await servicio.guardar({ ...producto, categoria_id: golosinas.id }, creado.id);
    await servicio.cargar();
    expect(servicio.productos().find(item => item.id === creado.id)?.categoria_id).toBe(golosinas.id);
    expect(servicio.gruposPublicados().find(grupo => grupo.nombre === 'Pochoclos')?.productos.some(item => item.id === creado.id)).toBe(false);
    expect(servicio.gruposPublicados().find(grupo => grupo.id === golosinas.id)?.productos.map(item => item.id)).toEqual([creado.id]);

    await servicio.cambiarPublicacion(creado.id, false);
    expect(servicio.gruposPublicados().some(grupo => grupo.id === golosinas.id)).toBe(false);
  });

  it('conserva productos anteriores al RF-035 en Otros hasta asignarles una categoría', async () => {
    const { categoria_id, ...anterior } = producto;
    localStorage.setItem(DEMO_KEY, JSON.stringify([{ ...anterior, id: 'producto-anterior' }]));
    await servicio.cargar();
    expect(servicio.productos()[0]).toEqual({ ...anterior, id: 'producto-anterior', categoria_id: CATEGORIA_OTROS_ID });
    expect(servicio.gruposPublicados()[0].nombre).toBe('Otros');
    await servicio.guardar({ ...anterior, categoria_id }, 'producto-anterior');
    await servicio.cargar();
    expect(servicio.gruposPublicados()[0].nombre).toBe('Pochoclos');
  });

  it('permite crear categorías persistentes, rechaza duplicados y exige rol administrador', async () => {
    await servicio.crearCategoria('  Snacks  salados  ');
    await servicio.cargar();
    expect(servicio.categorias().some(categoria => categoria.nombre === 'Snacks salados')).toBe(true);
    await expect(servicio.crearCategoria('snacks salados')).rejects.toThrow('Ya existe');
    await expect(servicio.crearCategoria('   ')).rejects.toThrow('entre 2 y 60');
    currentUserData.set({ ...perfil, rol: 'cliente' });
    await expect(servicio.crearCategoria('Sin permiso')).rejects.toThrow('Solo un administrador');
    currentUserData.set(null);
    await expect(servicio.crearCategoria('Sin sesión')).rejects.toThrow('Solo un administrador');
  });

  it('impide guardar productos con una categoría vacía o inexistente', async () => {
    await expect(servicio.guardar({ ...producto, categoria_id: '' })).rejects.toThrow('categoría válida');
    await expect(servicio.guardar({ ...producto, categoria_id: 'no-existe' })).rejects.toThrow('categoría válida');
    expect(localStorage.getItem(DEMO_KEY)).toBeNull();
  });
});
