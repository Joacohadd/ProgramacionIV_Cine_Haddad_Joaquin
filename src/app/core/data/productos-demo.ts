import { Producto } from '../models/producto.interface';

export const PRODUCTOS_DEMO: Producto[] = [
  { id: 'demo-producto-1', nombre: 'Pochoclos grandes', descripcion: 'Pochoclos dulces en un balde grande para acompañar la función.', categoria_id: 'c1000000-0000-4000-8000-000000000001', precio_centavos: 550000, imagen_url: '', activo: true },
  { id: 'demo-producto-2', nombre: 'Gaseosa', descripcion: 'Una bebida bien fría de 500 ml.', categoria_id: 'c1000000-0000-4000-8000-000000000002', precio_centavos: 300000, imagen_url: '', activo: true },
  { id: 'demo-producto-3', nombre: 'Agua mineral', descripcion: 'Agua mineral sin gas de 500 ml.', categoria_id: 'c1000000-0000-4000-8000-000000000002', precio_centavos: 200000, imagen_url: '', activo: true }
];
