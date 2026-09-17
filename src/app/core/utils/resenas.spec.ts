import { describe, expect, it } from 'vitest';
import { Resena } from '../models/resena.interface';
import { calcularPromedio } from './resenas';

const resenaBase: Resena = {
  id: 'r-1', pelicula_id: 'p-1', usuario_id: 'u-1', autor_nombre: 'Persona',
  estrellas: 5, comentario: 'Una gran historia.', creado_en: '2026-09-15T00:00:00Z'
};

describe('reseñas y calificaciones', () => {
  it('calcula el promedio con un decimal', () => {
    const resultado = calcularPromedio([
      resenaBase,
      { ...resenaBase, id: 'r-2', usuario_id: 'u-2', estrellas: 4 },
      { ...resenaBase, id: 'r-3', usuario_id: 'u-3', estrellas: 4 }
    ]);
    expect(resultado).toBe(4.3);
  });

  it('devuelve cero cuando todavía no hay reseñas', () => {
    expect(calcularPromedio([])).toBe(0);
  });
});
