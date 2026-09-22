import { ComboCandy } from '../models/combo-candy.interface';
import { ComboCompra, EntradaCompra } from '../models/compra.interface';

export function armarCombosCompra(
  combos: ComboCandy[],
  cantidades: Record<string, number>,
  limiteEntradas: number
): ComboCompra[] {
  let disponibles = Math.max(0, limiteEntradas);
  const seleccion: ComboCompra[] = [];
  for (const combo of combos.filter(item => item.activo)) {
    const solicitada = cantidades[combo.id] ?? 0;
    if (!Number.isInteger(solicitada) || solicitada < 1 || disponibles === 0) continue;
    const cantidad = Math.min(solicitada, disponibles, 20);
    seleccion.push({
      combo_id: combo.id,
      nombre: combo.nombre,
      cantidad,
      precio_unitario_centavos: combo.precio_centavos,
      subtotal_centavos: combo.precio_centavos * cantidad
    });
    disponibles -= cantidad;
  }
  return seleccion;
}

export function calcularTotalCombos(combos: ComboCompra[]): number {
  return combos.reduce((total, combo) => total + combo.subtotal_centavos, 0);
}

export function calcularEntradasFueraDeCombos(entradas: EntradaCompra[], combos: ComboCompra[]): number {
  const incluidas = combos.reduce((total, combo) => total + combo.cantidad, 0);
  return [...entradas]
    .sort((a, b) => a.precio_centavos - b.precio_centavos || a.butaca_codigo.localeCompare(b.butaca_codigo))
    .slice(incluidas)
    .reduce((total, entrada) => total + entrada.precio_centavos, 0);
}
