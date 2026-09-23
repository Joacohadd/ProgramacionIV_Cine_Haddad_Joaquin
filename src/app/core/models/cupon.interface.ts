export type TipoCupon = 'primera_compra' | 'mayores_50';

export interface Cupon {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCupon;
  porcentaje: number;
  activo: boolean;
}

export type CuponEditable = Omit<Cupon, 'id'>;
