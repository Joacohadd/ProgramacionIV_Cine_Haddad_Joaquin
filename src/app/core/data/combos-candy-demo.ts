import { ComboCandy } from '../models/combo-candy.interface';

export const COMBOS_CANDY_DEMO: ComboCandy[] = [
  {
    id: 'demo-combo-1',
    nombre: 'Umbral clásico',
    descripcion: 'Una entrada, pochoclos grandes y una gaseosa.',
    pochoclos_producto_id: 'demo-producto-1',
    bebida_producto_id: 'demo-producto-2',
    precio_centavos: 1250000,
    activo: true
  },
  {
    id: 'demo-combo-2',
    nombre: 'Umbral ligero',
    descripcion: 'Una entrada, pochoclos grandes y agua mineral.',
    pochoclos_producto_id: 'demo-producto-1',
    bebida_producto_id: 'demo-producto-3',
    precio_centavos: 1120000,
    activo: true
  }
];
