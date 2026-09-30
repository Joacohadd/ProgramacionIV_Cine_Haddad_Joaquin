import { ComboCompra, EntradaCompra, ProductoCompra } from '../models/compra.interface';
import { CanjeRecompensa } from '../models/recompensa.interface';
import { Producto } from '../models/producto.interface';

export function entradasCanjeables(entradas: EntradaCompra[], combos: ComboCompra[]): EntradaCompra[] {
  const incluidas = combos.reduce((total, combo) => total + combo.cantidad, 0);
  return [...entradas]
    .sort((a, b) => a.precio_centavos - b.precio_centavos || a.butaca_codigo.localeCompare(b.butaca_codigo))
    .slice(incluidas)
    .filter(entrada => entrada.tipo !== 'vip');
}

export function productosConCanjes(
  productos: ProductoCompra[], canjes: CanjeRecompensa[], catalogo: Producto[]
): ProductoCompra[] {
  const resultado = productos.map(producto => ({ ...producto }));
  for (const canje of canjes.filter(item => item.tipo === 'producto')) {
    const producto = catalogo.find(item => item.id === canje.producto_id && item.activo);
    if (!producto) throw new Error(`El producto de ${canje.recompensa_nombre} ya no está disponible.`);
    const existente = resultado.find(item => item.producto_id === producto.id);
    if (existente) {
      if (existente.cantidad >= 20) throw new Error(`El máximo para ${producto.nombre} es de 20 unidades, incluidos los premios.`);
      existente.cantidad++;
      existente.subtotal_centavos += producto.precio_centavos;
    } else {
      resultado.push({ producto_id: producto.id, nombre: producto.nombre, cantidad: 1,
        precio_unitario_centavos: producto.precio_centavos, subtotal_centavos: producto.precio_centavos });
    }
  }
  return resultado;
}

export function descuentoCanjes(
  canjes: CanjeRecompensa[], entradas: EntradaCompra[], combos: ComboCompra[], catalogo: Producto[]
): number {
  const entradasGratis = canjes.filter(canje => canje.tipo === 'entrada');
  const elegibles = entradasCanjeables(entradas, combos);
  if (entradasGratis.length > elegibles.length) {
    throw new Error('La entrada gratis requiere una butaca general o accesible fuera de los combos.');
  }
  return elegibles.slice(0, entradasGratis.length).reduce((total, entrada) => total + entrada.precio_centavos, 0)
    + canjes.filter(canje => canje.tipo === 'producto').reduce((total, canje) => {
      const producto = catalogo.find(item => item.id === canje.producto_id && item.activo);
      if (!producto) throw new Error(`El producto de ${canje.recompensa_nombre} ya no está disponible.`);
      return total + producto.precio_centavos;
    }, 0);
}
