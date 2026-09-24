export type PeriodoReporte = 'semana' | 'mes';

export interface VentaDiaria {
  codigo: string;
  creada_en: string;
  pelicula: string;
  entradas: number;
  total_centavos: number;
}

export interface PeliculaVista {
  pelicula_id: string;
  titulo: string;
  entradas: number;
}

export interface ProductoMasVendido {
  producto_id: string;
  nombre: string;
  cantidad: number;
}

export interface ReporteVentas {
  dia: string;
  periodo: PeriodoReporte;
  periodo_desde: string;
  periodo_hasta: string;
  facturacion_centavos: number;
  entradas_vendidas: number;
  compras: number;
  ventas: VentaDiaria[];
  peliculas: PeliculaVista[];
  producto_mas_vendido: ProductoMasVendido | null;
}
