export type TipoButaca = 'estandar' | 'accesible' | 'vip';
export type SectorButaca = 'izquierda' | 'centro' | 'derecha';
export type EstadoReservaButaca = 'reservada' | 'ocupada';
export type EstadoVisualButaca = 'libre' | 'seleccionada' | 'reservada' | 'ocupada';

export interface ButacaMapa {
  codigo: string;
  fila: string;
  numero: number;
  sector: SectorButaca;
  tipo: TipoButaca;
  precio_centavos: number;
}

export interface FilaButacas {
  etiqueta: string;
  tipo: TipoButaca;
  sectores: [ButacaMapa[], ButacaMapa[], ButacaMapa[]];
}

export interface ReservaButaca {
  id: string;
  funcion_id: string;
  fecha_funcion: string;
  butaca_codigo: string;
  tipo: TipoButaca;
  estado: EstadoReservaButaca;
  sesion_hash: string;
  precio_centavos: number;
  expira_en: string | null;
}
