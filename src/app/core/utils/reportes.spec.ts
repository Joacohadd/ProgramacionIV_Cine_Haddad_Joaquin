import { describe, expect, it } from 'vitest';
import { Compra } from '../models/compra.interface';
import { construirReporteDemo, diaVentaArgentina, rangoReporte } from './reportes';

const compra = (datos: Partial<Compra>): Compra => ({
  codigo: 'UMB-ABCDEFGHIJ', estado: 'pagada', creada_en: '2026-09-25T02:30:00Z',
  fecha_funcion: '2026-09-25', pelicula_id: 'pelicula-1', pelicula_titulo: 'Primera película',
  total_centavos: 250000, entradas: [{ butaca_codigo: 'A-01' }, { butaca_codigo: 'A-02' }],
  productos: [{ producto_id: 'producto-1', nombre: 'Pochoclos', cantidad: 2 }],
  ...datos
} as unknown as Compra);

describe('reportes de ventas', () => {
  it('usa el día de Argentina y excluye compras canceladas de la facturación', () => {
    const compras = [
      compra({}),
      compra({ codigo: 'UMB-ZZZZZZZZZZ', creada_en: '2026-09-24T15:00:00Z',
        total_centavos: 50000, entradas: [{ butaca_codigo: 'B-01' }],
        productos: [{ producto_id: 'producto-1', nombre: 'Pochoclos', cantidad: 1 }] } as Partial<Compra>),
      compra({ codigo: 'UMB-XXXXXXXXXX', estado: 'cancelada', total_centavos: 900000 })
    ];
    const reporte = construirReporteDemo(compras, '2026-09-24', 'semana');

    expect(diaVentaArgentina('2026-09-25T02:30:00Z')).toBe('2026-09-24');
    expect(reporte.facturacion_centavos).toBe(300000);
    expect(reporte.entradas_vendidas).toBe(3);
    expect(reporte.compras).toBe(2);
    expect(reporte.ventas).toHaveLength(2);
    expect(reporte.peliculas[0].entradas).toBe(3);
    expect(reporte.producto_mas_vendido?.cantidad).toBe(3);
  });

  it('agrupa las películas por fecha de función en semana y mes', () => {
    const compras = [compra({ fecha_funcion: '2026-09-30' })];
    expect(rangoReporte('2026-09-24', 'semana')).toEqual({ desde: '2026-09-21', hasta: '2026-09-27' });
    expect(rangoReporte('2026-09-24', 'mes')).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
    expect(construirReporteDemo(compras, '2026-09-24', 'semana').peliculas).toHaveLength(0);
    expect(construirReporteDemo(compras, '2026-09-24', 'mes').peliculas[0].entradas).toBe(2);
  });

  it('incluye pedidos de solo candy en las ventas y calcula el más vendido del día', () => {
    const compras = [
      compra({ codigo: 'UMB-CANDYCANDY', funcion_id: '', fecha_funcion: '', pelicula_id: '',
        entradas: [], productos: [{ producto_id: 'bebida', nombre: 'Bebida', cantidad: 4 }],
        creada_en: '2026-09-24T15:00:00Z' } as unknown as Partial<Compra>),
      compra({ codigo: 'UMB-OTRODIAAAA', productos: [{ producto_id: 'pochoclos', nombre: 'Pochoclos', cantidad: 8 }],
        creada_en: '2026-09-23T15:00:00Z' } as unknown as Partial<Compra>)
    ];
    const reporte = construirReporteDemo(compras, '2026-09-24', 'semana');
    expect(reporte.ventas[0].pelicula).toBe('Solo candy');
    expect(reporte.entradas_vendidas).toBe(0);
    expect(reporte.producto_mas_vendido?.nombre).toBe('Bebida');
    expect(reporte.producto_mas_vendido?.cantidad).toBe(4);
  });
});
