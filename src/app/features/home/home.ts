import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PeliculaService } from '../../core/services/pelicula.service';
import { filtrarYOrdenarCartelera } from '../../core/utils/cartelera';
import { Buscador } from '../../shared/components/buscador/buscador';
import { PeliculaCard } from '../../shared/components/pelicula-card/pelicula-card';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';

@Component({ selector: 'app-home', imports: [Buscador, PeliculaCard, DuracionPipe], templateUrl: './home.html', styleUrl: './home.css' })
export class Home {
  readonly servicio = inject(PeliculaService);
  private readonly router = inject(Router);
  readonly termino = signal('');
  readonly genero = signal('Todos');
  readonly generos = computed(() => ['Todos', ...new Set(this.servicio.peliculas().filter(p => p.visible_inicio).flatMap(p => p.generos))]);
  readonly peliculaPrincipal = computed(() => filtrarYOrdenarCartelera(this.servicio.peliculas(), '', 'Todos')[0]);
  readonly peliculasFiltradas = computed(() => filtrarYOrdenarCartelera(this.servicio.peliculas(), this.termino(), this.genero()));
  readonly destacadas = computed(() => this.peliculasFiltradas().slice(0, 3));
  readonly resto = computed(() => this.peliculasFiltradas().slice(3));
  readonly filtrando = computed(() => Boolean(this.termino().trim()) || this.genero() !== 'Todos');

  verDetalle(id: string): void { void this.router.navigate(['/pelicula', id]); }
  limpiarFiltros(): void { this.termino.set(''); this.genero.set('Todos'); }
}
