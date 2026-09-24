import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Perfil } from '../models/perfil.interface';
import { AuthService } from './auth.service';
import { RetiroCandyService } from './retiro-candy.service';
import { SupabaseService } from './supabase.service';

const COMPRAS_KEY = 'umbral-demo-compras';
const AUDITORIA_KEY = 'umbral-demo-auditoria';
const CODIGO = 'UMB-ABCDEFGHIJ';
const TOKEN = '12345678-1234-4123-8123-123456789012';

const empleado: Perfil = {
  id: 'empleado-prueba', email: 'empleado@umbral.demo', nombre: 'Personal', apellido: 'Prueba',
  fecha_nacimiento: '1990-01-01', tipo_sangre: 'O+', color_ojos: 'Marrón',
  dias_vacaciones: 0, rol: 'empleado', puntos: 0, credito_centavos: 0
};

const compra = {
  codigo: CODIGO, qr_token: TOKEN, estado: 'pagada', pelicula_titulo: 'Película de prueba',
  fecha_funcion: '2026-09-25', hora_inicio: '20:00', sala_nombre: 'Sala 1',
  entradas: [{ butaca_codigo: 'A-01' }],
  productos: [{ producto_id: 'p-1', nombre: 'Pochoclos', cantidad: 1,
    precio_unitario_centavos: 1000, subtotal_centavos: 1000 }],
  combos: [], ingreso_validado_en: null, candy_retirado_en: null
};

describe('validación del personal', () => {
  const currentUserData = signal<Perfil | null>(empleado);
  let servicio: RetiroCandyService;

  beforeEach(() => {
    localStorage.setItem(COMPRAS_KEY, JSON.stringify([compra]));
    localStorage.removeItem(AUDITORIA_KEY);
    currentUserData.set(empleado);
    TestBed.configureTestingModule({ providers: [
      { provide: SupabaseService, useValue: { client: null } },
      { provide: AuthService, useValue: { currentUserData } }
    ] });
    servicio = TestBed.inject(RetiroCandyService);
  });

  afterEach(() => {
    localStorage.removeItem(COMPRAS_KEY);
    localStorage.removeItem(AUDITORIA_KEY);
    TestBed.resetTestingModule();
  });

  it('consume ingreso y candy por separado e impide repetir cada operación', async () => {
    await servicio.consultar(`UMBRAL|${CODIGO}|${TOKEN}`, 'qr');
    await servicio.confirmar('ingreso');
    expect(servicio.resultado()?.ingreso_validado_en).toBeTruthy();
    expect(servicio.resultado()?.candy_retirado_en).toBeNull();

    await servicio.confirmar('ingreso');
    expect(servicio.error()).toContain('ya fue validado');
    await servicio.confirmar('candy');
    expect(servicio.resultado()?.candy_retirado_en).toBeTruthy();
    await servicio.confirmar('candy');
    expect(servicio.error()).toContain('ya fue entregado');

    const registros = JSON.parse(localStorage.getItem(AUDITORIA_KEY) ?? '[]') as { accion: string }[];
    expect(registros.map(registro => registro.accion)).toEqual(['candy_entregado', 'ingreso_validado']);
  });

  it('acepta el código manual y rechaza la validación para un cliente', async () => {
    await servicio.consultar(CODIGO.toLowerCase(), 'manual');
    expect(servicio.resultado()?.compra_codigo).toBe(CODIGO);
    currentUserData.set({ ...empleado, rol: 'cliente' });
    await servicio.confirmar('ingreso');
    expect(servicio.error()).toContain('Solo el personal');
    expect(servicio.resultado()?.ingreso_validado_en).toBeNull();
  });
});
