export interface AlertaPelicula {
  pelicula_id: string;
  pelicula_titulo: string;
  pelicula_imagen_url: string;
  fecha_estreno: string;
  creada_en: string;
  notificada_en: string | null;
  venta_disponible: boolean;
  notificacion_pendiente: boolean;
}

export interface PeliculaVista {
  compra_id: string;
  pelicula_id: string;
  pelicula_titulo: string;
  pelicula_imagen_url: string;
  fecha_funcion: string;
  formato: string;
  idioma: string;
  calificacion_propia: number | null;
}
