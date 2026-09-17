import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PeliculaService } from '../../../core/services/pelicula.service';
import { DuracionPipe } from '../../../shared/pipes/duracion.pipe';

@Component({ selector: 'app-peliculas-admin', imports: [RouterLink, DuracionPipe], templateUrl: './peliculas-admin.html', styleUrl: './peliculas-admin.css' })
export class PeliculasAdmin {
  readonly servicio = inject(PeliculaService);
}
