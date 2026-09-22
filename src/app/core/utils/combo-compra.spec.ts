import { describe, expect, it } from 'vitest';
import { ComboCandy } from '../models/combo-candy.interface';
import { EntradaCompra } from '../models/compra.interface';
import { armarCombosCompra, calcularEntradasFueraDeCombos, calcularTotalCombos } from './combo-compra';

const combos: ComboCandy[] = [
  { id: 'clasico', nombre: 'Clásico', descripcion: 'Entrada, pochoclos y bebida', pochoclos_producto_id: 'p1', bebida_producto_id: 'p2', precio_centavos: 1200000, activo: true },
  { id: 'oculto', nombre: 'Oculto', descripcion: 'No publicado', pochoclos_producto_id: 'p1', bebida_producto_id: 'p2', precio_centavos: 900000, activo: false }
];

const entradas: EntradaCompra[] = [
  { butaca_codigo: 'R-01', tipo: 'vip', precio_centavos: 900000 },
  { butaca_codigo: 'A-01', tipo: 'estandar', precio_centavos: 700000 }
];

describe('combos dentro de la compra', () => {
  it('limita los combos a la cantidad de entradas y calcula su precio fijo', () => {
    const seleccion = armarCombosCompra(combos, { clasico: 4, oculto: 1 }, entradas.length);
    expect(seleccion).toEqual([{
      combo_id: 'clasico', nombre: 'Clásico', cantidad: 2,
      precio_unitario_centavos: 1200000, subtotal_centavos: 2400000
    }]);
    expect(calcularTotalCombos(seleccion)).toBe(2400000);
  });

  it('aplica primero el combo a las entradas de menor precio', () => {
    const seleccion = armarCombosCompra(combos, { clasico: 1 }, entradas.length);
    expect(calcularEntradasFueraDeCombos(entradas, seleccion)).toBe(900000);
  });
});
