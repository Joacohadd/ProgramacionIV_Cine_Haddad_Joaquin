export interface Resena {
  id: string;
  pelicula_id: string;
  usuario_id: string;
  autor_nombre: string;
  estrellas: number;
  comentario: string;
  creado_en: string;
}

export type NuevaResena = Pick<Resena, 'pelicula_id' | 'usuario_id' | 'autor_nombre' | 'estrellas' | 'comentario'>;
