export type Clasificacion = 'ATP' | '13' | '18';

// Coincide con las columnas de la vista peliculas_con_ventas en Supabase.
export interface Pelicula {
  id: string;
  titulo: string;
  sinopsis: string;
  duracion_minutos: number;
  imagen_url: string;
  generos: string[];
  clasificacion: Clasificacion;
  visible_inicio: boolean;
  fecha_estreno: string;
  entradas_vendidas: number;
  promedio_calificacion: number;
  cantidad_resenas: number;
}

export type PeliculaEditable = Omit<Pelicula, 'id' | 'entradas_vendidas' | 'promedio_calificacion' | 'cantidad_resenas'>;
