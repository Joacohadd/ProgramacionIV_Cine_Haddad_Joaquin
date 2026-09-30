import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Perfil } from '../models/perfil.interface';
import { AuthService } from './auth.service';
import { CanjesPuntosPersonalService } from './canjes-puntos-personal.service';
import { SupabaseService } from './supabase.service';

const CANJES_KEY = 'umbral-demo-canjes';
const CODIGO_PRODUCTO = 'CAN-ABCDEFGHIJ';
const CODIGO_ENTRADA = 'CAN-ZYXWVUTSRQ';

const empleado: Perfil = {
  id: 'empleado-prueba', email: 'empleado@umbral.demo', nombre: 'Personal', apellido: 'Prueba',
  fecha_nacimiento: '1990-01-01', tipo_sangre: 'O+', color_ojos: 'Marrón',
  dias_vacaciones: 0, rol: 'empleado', puntos: 0, credito_centavos: 0
};

const canje = (codigo: string, tipo: 'entrada' | 'producto') => ({
  id: codigo, codigo, usuario_id: 'cliente-prueba', usuario_email: 'cliente@umbral.demo',
  recompensa_id: tipo, recompensa_nombre: tipo === 'producto' ? 'Balde de pochoclos' : 'Entrada gratis',
  recompensa_descripcion: 'Recompensa de prueba', tipo,
  producto_id: tipo === 'producto' ? 'producto-prueba' : null,
  producto_nombre: tipo === 'producto' ? 'Balde de pochoclos' : null,
  costo_puntos: 150, creado_en: '2026-09-29T12:00:00Z', entregado_en: null
});

describe('canjes de puntos del personal', () => {
  const currentUserData = signal<Perfil | null>(empleado);
  let servicio: CanjesPuntosPersonalService;

  beforeEach(() => {
    localStorage.setItem(CANJES_KEY, JSON.stringify([
      canje(CODIGO_PRODUCTO, 'producto'), canje(CODIGO_ENTRADA, 'entrada')
    ]));
    currentUserData.set(empleado);
    TestBed.configureTestingModule({ providers: [
      { provide: SupabaseService, useValue: { client: null } },
      { provide: AuthService, useValue: { currentUserData } }
    ] });
    servicio = TestBed.inject(CanjesPuntosPersonalService);
  });

  afterEach(() => {
    localStorage.removeItem(CANJES_KEY);
    TestBed.resetTestingModule();
  });

  it('permite consultar premios sin consumirlos', async () => {
    await servicio.consultar(CODIGO_PRODUCTO.toLowerCase());
    expect(servicio.resultado()?.tipo).toBe('producto');
    await servicio.consultar(CODIGO_ENTRADA);
    expect(servicio.resultado()?.tipo).toBe('entrada');
    const guardados = JSON.parse(localStorage.getItem(CANJES_KEY) ?? '[]') as { entregado_en: string | null }[];
    expect(guardados.every(item => item.entregado_en === null)).toBe(true);
  });

  it('acepta administradores y rechaza clientes', async () => {
    currentUserData.set({ ...empleado, rol: 'admin' });
    await servicio.consultar(CODIGO_PRODUCTO);
    expect(servicio.resultado()?.codigo).toBe(CODIGO_PRODUCTO);
    currentUserData.set({ ...empleado, rol: 'cliente' });
    await servicio.consultar(CODIGO_ENTRADA);
    expect(servicio.error()).toContain('Solo el personal');
    const guardados = JSON.parse(localStorage.getItem(CANJES_KEY) ?? '[]') as { entregado_en: string | null }[];
    expect(guardados[0].entregado_en).toBeNull();
  });
});
