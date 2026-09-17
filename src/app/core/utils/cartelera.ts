import { Pelicula } from '../models/pelicula.interface';

export function filtrarYOrdenarCartelera(peliculas: Pelicula[], termino: string, genero: string): Pelicula[] {
  const texto = termino.trim().toLocaleLowerCase('es-AR');
  return peliculas
    .filter(pelicula => pelicula.visible_inicio)
    .filter(pelicula => genero === 'Todos' || pelicula.generos.includes(genero))
    .filter(pelicula => !texto || [pelicula.titulo, pelicula.sinopsis, ...pelicula.generos]
      .some(valor => valor.toLocaleLowerCase('es-AR').includes(texto)))
    .sort((a, b) => b.entradas_vendidas - a.entradas_vendidas || a.titulo.localeCompare(b.titulo));
}
