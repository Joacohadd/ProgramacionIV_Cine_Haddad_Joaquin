import { ComboCompra, ProductoCompra } from './compra.interface';

export interface RetiroCandy {
  valida: boolean;
  estado: string;
  compra_codigo: string;
  pelicula_titulo: string;
  fecha_funcion: string;
  hora_inicio: string;
  sala_nombre: string;
  butacas: string[];
  productos: ProductoCompra[];
  combos: ComboCompra[];
  ingreso_validado_en: string | null;
  candy_retirado_en: string | null;
}

export interface CodigoQrCompra {
  codigo: string;
  token: string;
}
