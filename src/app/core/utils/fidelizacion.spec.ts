import { describe, expect, it } from 'vitest';
import { calcularPuntosCompra } from './fidelizacion';

describe('programa de fidelización', () => {
  it('acredita un punto por cada peso completo del total final', () => {
    expect(calcularPuntosCompra(125099)).toBe(1250);
    expect(calcularPuntosCompra(99)).toBe(0);
  });

  it('no acredita puntos para importes inválidos', () => {
    expect(calcularPuntosCompra(-100)).toBe(0);
    expect(calcularPuntosCompra(100.5)).toBe(0);
  });
});
