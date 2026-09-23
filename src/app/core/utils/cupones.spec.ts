import { describe, expect, it } from 'vitest';
import { calcularDescuento, esMayorDeCincuenta } from './cupones';

describe('cupones', () => {
  it('calcula el descuento en centavos sin producir decimales', () => {
    expect(calcularDescuento(12345, 20)).toBe(2469);
    expect(calcularDescuento(10000, 15)).toBe(1500);
  });

  it('rechaza porcentajes fuera del rango administrable', () => {
    expect(calcularDescuento(10000, 0)).toBe(0);
    expect(calcularDescuento(10000, 100)).toBe(0);
  });

  it('considera mayor de 50 solamente a quien ya cumplió 51 años', () => {
    expect(esMayorDeCincuenta('1975-09-22', '2026-09-22')).toBe(true);
    expect(esMayorDeCincuenta('1976-09-22', '2026-09-22')).toBe(false);
    expect(esMayorDeCincuenta('1975-09-23', '2026-09-22')).toBe(false);
  });
});
