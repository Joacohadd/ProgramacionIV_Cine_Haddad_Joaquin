export interface ComboCandy {
  id: string;
  nombre: string;
  descripcion: string;
  pochoclos_producto_id: string;
  bebida_producto_id: string;
  precio_centavos: number;
  activo: boolean;
}

export type ComboCandyEditable = Omit<ComboCandy, 'id'>;
