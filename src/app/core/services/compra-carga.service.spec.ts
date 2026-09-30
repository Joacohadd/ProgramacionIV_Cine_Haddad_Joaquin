import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Perfil } from '../models/perfil.interface';
import { AuthService } from './auth.service';
import { ButacasService } from './butacas.service';
import { ComboCandyService } from './combo-candy.service';
import { CompraService } from './compra.service';
import { CuponService } from './cupon.service';
import { PeliculaService } from './pelicula.service';
import { ProductoService } from './producto.service';
import { SupabaseService } from './supabase.service';

const perfil = { id: 'cliente-prueba' } as Perfil;

describe('carga de compras', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('termina la carga y permite reintentar cuando falla la consulta', async () => {
    let falla = true;
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({
        abortSignal: () => falla
          ? Promise.reject(new Error('Fallo de red'))
          : Promise.resolve({ data: [], error: null })
      }) }) }) })
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({ providers: [
      { provide: SupabaseService, useValue: { client } },
      { provide: AuthService, useValue: { currentUserData: signal<Perfil | null>(perfil) } },
      { provide: ButacasService, useValue: {} },
      { provide: PeliculaService, useValue: {} },
      { provide: ProductoService, useValue: {} },
      { provide: ComboCandyService, useValue: {} },
      { provide: CuponService, useValue: {} }
    ] });
    const compras = TestBed.inject(CompraService);

    await compras.cargarCompras();
    expect(compras.cargando()).toBe(false);
    expect(compras.error()).toContain('Intentá de nuevo');

    falla = false;
    await compras.cargarCompras();
    expect(compras.cargando()).toBe(false);
    expect(compras.error()).toBeNull();
    expect(compras.compras()).toEqual([]);
  });
});
