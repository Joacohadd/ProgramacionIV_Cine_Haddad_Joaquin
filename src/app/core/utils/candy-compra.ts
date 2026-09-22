import { ProductoCompra } from '../models/compra.interface';
import { Producto } from '../models/producto.interface';

export const MAXIMO_PRODUCTOS_POR_ITEM = 20;

export function armarProductosCompra(
  productos: Producto[],
  cantidades: Record<string, number>
): ProductoCompra[] {
  return productos
    .filter(producto => producto.activo)
    .map(producto => ({ producto, cantidad: cantidades[producto.id] ?? 0 }))
    .filter(item => Number.isInteger(item.cantidad) && item.cantidad > 0)
    .map(({ producto, cantidad }) => {
      const cantidadSegura = Math.min(cantidad, MAXIMO_PRODUCTOS_POR_ITEM);
      return {
        producto_id: producto.id,
        nombre: producto.nombre,
        cantidad: cantidadSegura,
        precio_unitario_centavos: producto.precio_centavos,
        subtotal_centavos: producto.precio_centavos * cantidadSegura
      };
    });
}

export function calcularTotalProductos(productos: ProductoCompra[]): number {
  return productos.reduce((total, producto) => total + producto.subtotal_centavos, 0);
}
