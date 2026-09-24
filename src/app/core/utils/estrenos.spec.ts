import { describe, expect, it } from 'vitest';
import { inicioPreventa, precioBaseVigente, preventaActiva, ventaHabilitada } from './estrenos';

const pelicula = {
  fecha_estreno: '2026-10-10',
  preventa_habilitada: true,
  precio_preventa_centavos: 600000
};

describe('preventa', () => {
  it('abre exactamente siete días antes del estreno', () => {
    expect(inicioPreventa(pelicula)).toBe('2026-10-03');
    expect(preventaActiva(pelicula, '2026-10-02')).toBe(false);
    expect(preventaActiva(pelicula, '2026-10-03')).toBe(true);
  });

  it('restaura el precio normal desde el día del estreno', () => {
    expect(precioBaseVigente(pelicula, '2026-10-09', 800000)).toBe(600000);
    expect(precioBaseVigente(pelicula, '2026-10-10', 800000)).toBe(800000);
    expect(ventaHabilitada(pelicula, '2026-10-10')).toBe(true);
  });
});
