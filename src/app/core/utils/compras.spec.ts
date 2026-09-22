import { describe, expect, it } from 'vitest';
import { cumpleRestriccionEdad, edadEnFecha, puedeCancelarCompra } from './compras';

describe('reglas de compra', () => {
  it('calcula la edad en la fecha de la función y contempla el cumpleaños', () => {
    expect(edadEnFecha('2013-09-18', '2026-09-17')).toBe(12);
    expect(edadEnFecha('2013-09-18', '2026-09-18')).toBe(13);
  });

  it('bloquea a quien no alcanza la clasificación requerida', () => {
    expect(cumpleRestriccionEdad('2013-09-18', '2026-09-17', '13')).toBe(false);
    expect(cumpleRestriccionEdad('2008-09-17', '2026-09-17', '18')).toBe(true);
    expect(cumpleRestriccionEdad('2020-01-01', '2026-09-17', 'ATP')).toBe(true);
  });

  it('permite cancelar hasta exactamente dos horas antes', () => {
    const ahora = new Date('2026-09-17T16:00:00');
    expect(puedeCancelarCompra('2026-09-17', '18:00', ahora)).toBe(true);
    expect(puedeCancelarCompra('2026-09-17', '17:59', ahora)).toBe(false);
  });
});
