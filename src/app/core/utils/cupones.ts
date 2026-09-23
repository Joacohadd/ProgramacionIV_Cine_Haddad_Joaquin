import { edadEnFecha } from './compras';

export function calcularDescuento(subtotalCentavos: number, porcentaje: number): number {
  if (!Number.isInteger(subtotalCentavos) || subtotalCentavos < 0) return 0;
  if (!Number.isInteger(porcentaje) || porcentaje < 1 || porcentaje > 99) return 0;
  return Math.floor(subtotalCentavos * porcentaje / 100);
}

export function esMayorDeCincuenta(fechaNacimiento: string, fechaReferencia: string): boolean {
  return edadEnFecha(fechaNacimiento, fechaReferencia) > 50;
}
