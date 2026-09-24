import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Pelicula } from '../../core/models/pelicula.interface';
import { AuthService } from '../../core/services/auth.service';
import { EstrenosService } from '../../core/services/estrenos.service';
import { PeliculaService } from '../../core/services/pelicula.service';
import { filtrarYOrdenarCartelera } from '../../core/utils/cartelera';
import { inicioPreventa, preventaActiva, ventaHabilitada } from '../../core/utils/estrenos';
import { Buscador } from '../../shared/components/buscador/buscador';
import { PeliculaCard } from '../../shared/components/pelicula-card/pelicula-card';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';

@Component({ selector: 'app-home', imports: [RouterLink, Buscador, PeliculaCard, DuracionPipe], templateUrl: './home.html', styleUrl: './home.css' })
export class Home {
  readonly servicio = inject(PeliculaService);
  readonly auth = inject(AuthService);
  readonly estrenos = inject(EstrenosService);
  private readonly router = inject(Router);
  private readonly hoy = this.fechaISO(new Date());
  readonly termino = signal('');
  readonly genero = signal('Todos');
  readonly carteleraActual = computed(() => this.servicio.peliculas()
    .filter(pelicula => pelicula.visible_inicio && pelicula.fecha_estreno <= this.hoy));
  readonly proximamente = computed(() => this.servicio.peliculas()
    .filter(pelicula => pelicula.visible_inicio && pelicula.fecha_estreno > this.hoy)
    .sort((a, b) => a.fecha_estreno.localeCompare(b.fecha_estreno)));
  readonly generos = computed(() => ['Todos', ...new Set(this.carteleraActual().flatMap(p => p.generos))]);
  readonly peliculaPrincipal = computed(() => filtrarYOrdenarCartelera(this.carteleraActual(), '', 'Todos')[0]);
  readonly peliculasFiltradas = computed(() => filtrarYOrdenarCartelera(this.carteleraActual(), this.termino(), this.genero()));
  readonly destacadas = computed(() => this.peliculasFiltradas().slice(0, 3));
  readonly resto = computed(() => this.peliculasFiltradas().slice(3));
  readonly filtrando = computed(() => Boolean(this.termino().trim()) || this.genero() !== 'Todos');

  constructor() {
    effect(() => {
      this.auth.currentUserData();
      void this.estrenos.cargarAlertas();
    });
  }

  verDetalle(id: string): void { void this.router.navigate(['/pelicula', id]); }
  limpiarFiltros(): void { this.termino.set(''); this.genero.set('Todos'); }

  async alternarAlerta(peliculaId: string): Promise<void> {
    try {
      if (this.estrenos.tieneAlerta(peliculaId)) await this.estrenos.desactivarAlerta(peliculaId);
      else await this.estrenos.activarAlerta(peliculaId);
    } catch { /* El servicio muestra el mensaje. */ }
  }

  ventaDisponible(pelicula: Pelicula): boolean { return ventaHabilitada(pelicula, this.hoy); }
  enPreventa(pelicula: Pelicula): boolean { return preventaActiva(pelicula, this.hoy); }
  inicioVenta(pelicula: Pelicula): string {
    return this.fechaLarga(pelicula.preventa_habilitada ? inicioPreventa(pelicula) : pelicula.fecha_estreno);
  }
  fechaLarga(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${fecha}T00:00:00Z`));
  }
  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
      .format(centavos / 100);
  }

  private fechaISO(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }
}
