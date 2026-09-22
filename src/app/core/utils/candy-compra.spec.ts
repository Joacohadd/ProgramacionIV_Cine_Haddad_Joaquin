import { describe, expect, it } from 'vitest';
import { Producto } from '../models/producto.interface';
import { armarProductosCompra, calcularTotalProductos } from './candy-compra';

const productos: Producto[] = [
  { id: 'pochoclos', nombre: 'Pochoclos', descripcion: 'Balde grande', categoria_id: '1', precio_centavos: 550000, imagen_url: '', activo: true },
  { id: 'agua', nombre: 'Agua', descripcion: 'Botella fría', categoria_id: '2', precio_centavos: 200000, imagen_url: '', activo: true },
  { id: 'oculto', nombre: 'Producto oculto', descripcion: 'No publicado', categoria_id: '2', precio_centavos: 100000, imagen_url: '', activo: false }
];

describe('compra conjunta de candy', () => {
  it('arma los renglones seleccionados con cantidad, precio y subtotal', () => {
    const seleccion = armarProductosCompra(productos, { pochoclos: 2, agua: 1 });

    expect(seleccion).toEqual([
      { producto_id: 'pochoclos', nombre: 'Pochoclos', cantidad: 2, precio_unitario_centavos: 550000, subtotal_centavos: 1100000 },
      { producto_id: 'agua', nombre: 'Agua', cantidad: 1, precio_unitario_centavos: 200000, subtotal_centavos: 200000 }
    ]);
    expect(calcularTotalProductos(seleccion)).toBe(1300000);
  });

  it('descarta cantidades vacías y productos que ya no están publicados', () => {
    expect(armarProductosCompra(productos, { pochoclos: 0, oculto: 2 })).toEqual([]);
  });

  it('limita cada producto a veinte unidades', () => {
    const [seleccion] = armarProductosCompra(productos, { agua: 30 });
    expect(seleccion.cantidad).toBe(20);
    expect(seleccion.subtotal_centavos).toBe(4000000);
  });
});
