export function calcularPuntosCompra(totalCentavos: number): number {
  if (!Number.isInteger(totalCentavos) || totalCentavos < 0) return 0;
  return Math.floor(totalCentavos / 100);
}
