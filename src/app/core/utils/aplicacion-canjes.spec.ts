import { describe, expect, it } from 'vitest';
import { EntradaCompra, ProductoCompra, ComboCompra } from '../models/compra.interface';
import { CanjeRecompensa } from '../models/recompensa.interface';
import { Producto } from '../models/producto.interface';
import { descuentoCanjes, productosConCanjes } from './aplicacion-canjes';

const entrada = (codigo: string, tipo: EntradaCompra['tipo'], precio: number): EntradaCompra =>
  ({ butaca_codigo: codigo, tipo, precio_centavos: precio });
const premio = (codigo: string, tipo: 'entrada' | 'producto'): CanjeRecompensa => ({
  id: codigo, codigo, recompensa_id: codigo, recompensa_nombre: tipo === 'entrada' ? 'Entrada gratis' : 'Balde',
  recompensa_descripcion: '', tipo, producto_id: tipo === 'producto' ? 'balde' : null,
  producto_nombre: tipo === 'producto' ? 'Balde' : null, costo_puntos: 100, creado_en: '', entregado_en: null
});
const balde = { id: 'balde', nombre: 'Balde', precio_centavos: 300000, activo: true } as Producto;

describe('premios de puntos en el checkout', () => {
  it('cubre la entrada elegible fuera del combo y agrega el producto gratis', () => {
    const entradas = [entrada('A-01', 'estandar', 400000), entrada('A-02', 'accesible', 400000), entrada('A-03', 'vip', 700000)];
    const combos = [{ combo_id: 'combo', nombre: 'Combo', cantidad: 1, precio_unitario_centavos: 500000, subtotal_centavos: 500000 }] as ComboCompra[];
    const canjes = [premio('CAN-ENTRADA01', 'entrada'), premio('CAN-PRODUCTO1', 'producto')];
    const productos = productosConCanjes([], canjes, [balde]);
    expect(productos).toEqual([{ producto_id: 'balde', nombre: 'Balde', cantidad: 1,
      precio_unitario_centavos: 300000, subtotal_centavos: 300000 }] as ProductoCompra[]);
    expect(descuentoCanjes(canjes, entradas, combos, [balde])).toBe(700000);
  });

  it('no permite usar una entrada gratis si solo hay VIP o entradas incluidas en combos', () => {
    expect(() => descuentoCanjes([premio('CAN-ENTRADA01', 'entrada')],
      [entrada('A-01', 'estandar', 400000), entrada('A-02', 'vip', 700000)],
      [{ combo_id: 'combo', nombre: 'Combo', cantidad: 1, precio_unitario_centavos: 500000, subtotal_centavos: 500000 }],
      [balde])).toThrow('fuera de los combos');
  });
});
