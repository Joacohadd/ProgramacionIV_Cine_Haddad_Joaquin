import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PeliculaService } from '../../core/services/pelicula.service';
import { ProgramacionService } from '../../core/services/programacion.service';
import { ResenaService } from '../../core/services/resena.service';
import { EstrenosService } from '../../core/services/estrenos.service';
import { DIAS_SEMANA, FuncionDetalle } from '../../core/models/programacion.interface';
import { horaFin } from '../../core/utils/planificacion';
import { inicioPreventa, preventaActiva, ventaHabilitada } from '../../core/utils/estrenos';
import { CalificacionEstrellas } from '../../shared/components/calificacion-estrellas/calificacion-estrellas';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';

@Component({ selector: 'app-pelicula-detalle', imports: [RouterLink, ReactiveFormsModule, CalificacionEstrellas, DuracionPipe], templateUrl: './pelicula-detalle.html', styleUrl: './pelicula-detalle.css' })
export class PeliculaDetalle {
  readonly id = input.required<string>();
  private readonly servicio = inject(PeliculaService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  readonly programacion = inject(ProgramacionService);
  readonly resenasServicio = inject(ResenaService);
  readonly estrenos = inject(EstrenosService);
  readonly resenas = this.resenasServicio.resenas;
  readonly promedio = this.resenasServicio.promedio;
  readonly cantidadResenas = this.resenasServicio.cantidad;
  readonly estrellasElegidas = signal(0);
  readonly enviandoResena = signal(false);
  readonly formError = signal<string | null>(null);
  readonly formMensaje = signal<string | null>(null);
  private readonly hoy = this.fechaISO(new Date());
  readonly resenaForm = this.fb.nonNullable.group({
    comentario: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(280)]]
  });
  readonly pelicula = computed(() => this.servicio.peliculas().find(item => item.id === this.id() && item.visible_inicio));
  readonly esProxima = computed(() => Boolean(this.pelicula() && this.pelicula()!.fecha_estreno > this.hoy));
  readonly ventaDisponible = computed(() => {
    const pelicula = this.pelicula();
    return pelicula ? ventaHabilitada(pelicula, this.hoy) : false;
  });
  readonly enPreventa = computed(() => {
    const pelicula = this.pelicula();
    return pelicula ? preventaActiva(pelicula, this.hoy) : false;
  });
  readonly funciones = computed(() => this.ventaDisponible() ? this.programacion.funcionesPorPelicula(this.id()) : []);
  readonly fecha = computed(() => {
    const date = this.pelicula()?.fecha_estreno;
    if (!date) return '';
    return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  });

  constructor() {
    effect(() => {
      const peliculaId = this.id();
      if (peliculaId) {
        this.estrellasElegidas.set(0);
        this.resenaForm.reset();
        this.formError.set(null);
        this.formMensaje.set(null);
        void this.resenasServicio.cargarPorPelicula(peliculaId);
      }
    });
    effect(() => {
      this.id();
      this.auth.currentUserData();
      void this.estrenos.cargarAlertas();
    });
  }

  async publicarResena(): Promise<void> {
    this.resenaForm.markAllAsTouched();
    this.formError.set(null);
    this.formMensaje.set(null);
    const pelicula = this.pelicula();
    if (!pelicula) return;
    if (!this.estrellasElegidas()) {
      this.formError.set('Elegí una puntuación de 1 a 5 estrellas.');
      return;
    }
    if (this.resenaForm.invalid) return;
    this.enviandoResena.set(true);
    try {
      await this.resenasServicio.crear(pelicula.id, this.estrellasElegidas(), this.resenaForm.controls.comentario.value);
      this.resenaForm.reset();
      this.estrellasElegidas.set(0);
      this.formMensaje.set(this.resenasServicio.mensaje() ?? 'Tu reseña quedó publicada.');
    } catch (error) {
      this.formError.set(error instanceof Error ? error.message : 'No se pudo publicar la reseña.');
    } finally { this.enviandoResena.set(false); }
  }

  fechaResena(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(fecha));
  }

  diasFuncion(funcion: FuncionDetalle): string {
    return funcion.dias_semana.map(valor => DIAS_SEMANA.find(dia => dia.valor === valor)?.nombre).join(' · ');
  }

  horaFinal(funcion: FuncionDetalle): string { return horaFin(funcion.hora_inicio, funcion.duracion_minutos); }

  async alternarAlerta(): Promise<void> {
    const peliculaId = this.pelicula()?.id;
    if (!peliculaId) return;
    try {
      if (this.estrenos.tieneAlerta(peliculaId)) await this.estrenos.desactivarAlerta(peliculaId);
      else await this.estrenos.activarAlerta(peliculaId);
    } catch { /* El servicio muestra el mensaje. */ }
  }

  inicioVenta(): string {
    const pelicula = this.pelicula();
    if (!pelicula) return '';
    return this.fechaLarga(pelicula.preventa_habilitada ? inicioPreventa(pelicula) : pelicula.fecha_estreno);
  }

  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
      .format(centavos / 100);
  }

  private fechaLarga(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${fecha}T00:00:00Z`));
  }

  private fechaISO(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }
}
