import { Resena } from '../models/resena.interface';

// Reseñas ficticias para poder recorrer el punto 4.3 en modo muestra.
export const RESENAS_DEMO: Resena[] = [
  { id: 'review-1', pelicula_id: 'demo-1', usuario_id: 'demo-reviewer-1', autor_nombre: 'Micaela R.', estrellas: 5, comentario: 'Una historia que se queda dando vueltas mucho después de salir de la sala.', creado_en: '2026-09-10T20:15:00Z' },
  { id: 'review-2', pelicula_id: 'demo-1', usuario_id: 'demo-reviewer-2', autor_nombre: 'Tomás G.', estrellas: 4, comentario: 'La luz y el silencio cuentan tanto como los personajes. Muy recomendable.', creado_en: '2026-09-09T18:40:00Z' },
  { id: 'review-3', pelicula_id: 'demo-2', usuario_id: 'demo-reviewer-3', autor_nombre: 'Lara P.', estrellas: 4, comentario: 'Sensibilísima, con una fotografía preciosa y un final para conversar.', creado_en: '2026-09-08T21:05:00Z' },
  { id: 'review-4', pelicula_id: 'demo-2', usuario_id: 'demo-reviewer-4', autor_nombre: 'Julián S.', estrellas: 5, comentario: 'El mar se siente como un personaje más. Me encantó.', creado_en: '2026-09-07T19:20:00Z' },
  { id: 'review-5', pelicula_id: 'demo-3', usuario_id: 'demo-reviewer-5', autor_nombre: 'Agustina V.', estrellas: 5, comentario: 'Ciencia ficción con ideas grandes y una tensión que no afloja.', creado_en: '2026-09-10T23:10:00Z' },
  { id: 'review-6', pelicula_id: 'demo-3', usuario_id: 'demo-reviewer-6', autor_nombre: 'Nico F.', estrellas: 5, comentario: 'El diseño sonoro es increíble. Ideal para verla en pantalla grande.', creado_en: '2026-09-06T22:00:00Z' },
  { id: 'review-7', pelicula_id: 'demo-3', usuario_id: 'demo-reviewer-7', autor_nombre: 'Caro M.', estrellas: 4, comentario: 'Una aventura espacial distinta, con mucho para pensar.', creado_en: '2026-09-05T17:30:00Z' },
  { id: 'review-8', pelicula_id: 'demo-4', usuario_id: 'demo-reviewer-8', autor_nombre: 'Sofía D.', estrellas: 4, comentario: 'Tierna y misteriosa, como un cuento contado de noche.', creado_en: '2026-09-08T16:10:00Z' },
  { id: 'review-9', pelicula_id: 'demo-4', usuario_id: 'demo-reviewer-9', autor_nombre: 'Bruno A.', estrellas: 4, comentario: 'Una fantasía tranquila, con imágenes hermosas.', creado_en: '2026-09-04T15:45:00Z' },
  { id: 'review-10', pelicula_id: 'demo-5', usuario_id: 'demo-reviewer-10', autor_nombre: 'Valen C.', estrellas: 3, comentario: 'Va construyendo el misterio de a poco y deja un clima muy particular.', creado_en: '2026-09-07T23:15:00Z' },
  { id: 'review-11', pelicula_id: 'demo-5', usuario_id: 'demo-reviewer-11', autor_nombre: 'Ezequiel N.', estrellas: 4, comentario: 'Inquietante, sobre todo cuando llega el silencio.', creado_en: '2026-09-03T20:50:00Z' },
  { id: 'review-12', pelicula_id: 'demo-6', usuario_id: 'demo-reviewer-12', autor_nombre: 'Paz L.', estrellas: 5, comentario: 'Una película pequeña y enorme a la vez. Salí con ganas de llamar a mi familia.', creado_en: '2026-09-02T18:30:00Z' }
];
