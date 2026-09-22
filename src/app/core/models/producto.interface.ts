export interface Producto {
  id: string;
  nombre: string;
  descripcion: string;
  categoria_id: string;
  precio_centavos: number;
  imagen_url: string;
  activo: boolean;
}

export type ProductoEditable = Omit<Producto, 'id'>;
