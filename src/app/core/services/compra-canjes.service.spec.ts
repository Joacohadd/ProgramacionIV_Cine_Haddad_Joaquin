import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Perfil } from '../models/perfil.interface';
import { Producto } from '../models/producto.interface';
import { AuthService } from './auth.service';
import { ButacasService } from './butacas.service';
import { ComboCandyService } from './combo-candy.service';
import { CompraService } from './compra.service';
import { CuponService } from './cupon.service';
import { PeliculaService } from './pelicula.service';
import { ProductoService } from './producto.service';
import { SupabaseService } from './supabase.service';

const perfil: Perfil = {
  id: 'cliente-prueba', email: 'cliente@umbral.demo', nombre: 'Cliente', apellido: 'Prueba',
  fecha_nacimiento: '1990-01-01', tipo_sangre: 'O+', color_ojos: 'Marrón',
  dias_vacaciones: 0, rol: 'cliente', puntos: 400, credito_centavos: 0
};
const producto = { id: 'balde', nombre: 'Balde de pochoclos', precio_centavos: 300000, activo: true } as Producto;
const codigo = 'CAN-ABCDEFGHIJ';

describe('uso de premios en compra de candy', () => {
  const usuario = signal<Perfil | null>(perfil);
  let compras: CompraService;

  beforeEach(() => {
    usuario.set({ ...perfil });
    localStorage.setItem('umbral-demo-canjes', JSON.stringify([{
      id: 'canje-balde', codigo, usuario_id: perfil.id, recompensa_id: 'premio-balde',
      recompensa_nombre: 'Balde de pochoclos', recompensa_descripcion: '', tipo: 'producto',
      producto_id: producto.id, producto_nombre: producto.nombre, costo_puntos: 150,
      creado_en: '2026-09-29T12:00:00Z', entregado_en: null
    }]));
    TestBed.configureTestingModule({ providers: [
      { provide: SupabaseService, useValue: { client: null } },
      { provide: AuthService, useValue: {
        currentUserData: usuario,
        actualizarCreditoDemo: (credito: number) => usuario.update(actual => actual && ({ ...actual, credito_centavos: credito })),
        actualizarPuntosDemo: (puntos: number) => usuario.update(actual => actual && ({ ...actual, puntos }))
      } },
      { provide: ProductoService, useValue: { publicados: signal([producto]) } },
      { provide: ButacasService, useValue: {} },
      { provide: PeliculaService, useValue: {} },
      { provide: ComboCandyService, useValue: {} },
      { provide: CuponService, useValue: {} }
    ] });
    compras = TestBed.inject(CompraService);
  });

  afterEach(() => {
    for (const clave of ['umbral-demo-canjes', 'umbral-demo-compras', 'umbral-demo-auditoria']) localStorage.removeItem(clave);
    TestBed.resetTestingModule();
  });

  it('genera pedido gratuito, consume el premio una sola vez y conserva los puntos ya gastados', async () => {
    const datos = { email: perfil.email, usar_credito: false, medio_pago: 'tarjeta_credito' as const };
    const items = [{ producto_id: producto.id, nombre: producto.nombre, cantidad: 1,
      precio_unitario_centavos: producto.precio_centavos, subtotal_centavos: producto.precio_centavos }];
    const compra = await compras.confirmarSoloCandy(datos, items, [codigo]);
    expect(compra.total_centavos).toBe(0);
    expect(compra.recompensas_descuento_centavos).toBe(300000);
    expect(compra.puntos_ganados).toBe(0);
    expect(usuario()?.puntos).toBe(400);
    const canjes = JSON.parse(localStorage.getItem('umbral-demo-canjes') ?? '[]') as { compra_id: string }[];
    expect(canjes[0].compra_id).toBe(compra.id);
    await expect(compras.confirmarSoloCandy(datos, items, [codigo])).rejects.toThrow('ya fue usado');
    expect(compras.compras()).toHaveLength(1);
  });
});
