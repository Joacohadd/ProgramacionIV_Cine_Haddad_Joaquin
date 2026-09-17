import { Component, input, output } from '@angular/core';
import { Pelicula } from '../../../core/models/pelicula.interface';
import { DuracionPipe } from '../../pipes/duracion.pipe';
import { CalificacionEstrellas } from '../calificacion-estrellas/calificacion-estrellas';

@Component({ selector: 'app-pelicula-card', imports: [DuracionPipe, CalificacionEstrellas], templateUrl: './pelicula-card.html', styleUrl: './pelicula-card.css' })
export class PeliculaCard {
  readonly pelicula = input.required<Pelicula>();
  readonly ranking = input<number | null>(null);
  readonly ver = output<string>();
}
