import { TipoButaca } from './butaca.interface';
import { FormatoProyeccion, IdiomaFuncion } from './programacion.interface';

export type MedioPago = 'tarjeta_credito' | 'tarjeta_debito' | 'billetera_virtual' | 'credito';
export type EstadoCompra = 'pagada' | 'cancelada';

export interface EntradaCompra {
  butaca_codigo: string;
  tipo: TipoButaca;
  precio_centavos: number;
}

export interface ProductoCompra {
  producto_id: string;
  nombre: string;
  cantidad: number;
  precio_unitario_centavos: number;
  subtotal_centavos: number;
}

export interface ComboCompra {
  combo_id: string;
  nombre: string;
  cantidad: number;
  precio_unitario_centavos: number;
  subtotal_centavos: number;
}

export interface Compra {
  id: string;
  codigo: string;
  usuario_id: string | null;
  comprador_email: string;
  funcion_id: string;
  pelicula_id: string;
  pelicula_titulo: string;
  sala_nombre: string;
  fecha_funcion: string;
  hora_inicio: string;
  formato: FormatoProyeccion;
  idioma: IdiomaFuncion;
  entradas_total_centavos: number;
  productos_total_centavos: number;
  combos_total_centavos: number;
  subtotal_centavos: number;
  descuento_centavos: number;
  cupon_id: string | null;
  cupon_codigo: string | null;
  cupon_porcentaje: number | null;
  total_centavos: number;
  credito_usado_centavos: number;
  pago_otro_centavos: number;
  medio_pago: MedioPago;
  estado: EstadoCompra;
  qr_token: string;
  aviso_adulto: boolean;
  creada_en: string;
  cancelada_en: string | null;
  candy_retirado_en: string | null;
  entradas: EntradaCompra[];
  productos: ProductoCompra[];
  combos: ComboCompra[];
}

export interface DatosConfirmacionCompra {
  email: string;
  fecha_nacimiento: string;
  usar_credito: boolean;
  medio_pago: Exclude<MedioPago, 'credito'>;
}

export interface ResultadoCompraRpc {
  compra_id: string;
  compra_codigo: string;
  compra_qr_token: string;
  entradas_total_centavos: number;
  productos_total_centavos: number;
  combos_total_centavos: number;
  subtotal_centavos: number;
  descuento_centavos: number;
  cupon_id: string | null;
  cupon_codigo: string | null;
  cupon_porcentaje: number | null;
  total_centavos: number;
  credito_usado_centavos: number;
  pago_otro_centavos: number;
  medio_pago: MedioPago;
  aviso_adulto: boolean;
  comprador_email: string;
  creada_en: string;
  productos: ProductoCompra[];
  combos: ComboCompra[];
}
