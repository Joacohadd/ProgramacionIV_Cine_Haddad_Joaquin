import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Clasificacion, PeliculaEditable } from '../../../core/models/pelicula.interface';
import { PeliculaService } from '../../../core/services/pelicula.service';

@Component({ selector: 'app-pelicula-form', imports: [ReactiveFormsModule, RouterLink], templateUrl: './pelicula-form.html', styleUrl: './pelicula-form.css' })
export class PeliculaForm {
  readonly id = input<string>();
  readonly servicio = inject(PeliculaService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  readonly editando = computed(() => Boolean(this.id()));
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly generosDisponibles = ['Acción', 'Aventura', 'Ciencia ficción', 'Comedia', 'Drama', 'Fantasía', 'Misterio', 'Romance', 'Suspenso', 'Terror', 'Documental', 'Animación'];
  readonly generosSeleccionados = signal<string[]>([]);
  readonly form = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    sinopsis: ['', [Validators.required, Validators.minLength(15), Validators.maxLength(1200)]],
    duracion_minutos: [90, [Validators.required, Validators.min(1), Validators.max(600)]],
    imagen_url: ['', [Validators.required, Validators.pattern(/^(https:\/\/|\/posters\/).+/)]],
    clasificacion: ['ATP' as Clasificacion, Validators.required],
    visible_inicio: [true],
    fecha_estreno: ['', Validators.required]
  });

  constructor() {
    effect(() => {
      const id = this.id();
      const actual = id && this.servicio.peliculas().find(item => item.id === id);
      if (actual) {
        this.form.patchValue(actual, { emitEvent: false });
        this.generosSeleccionados.set([...actual.generos]);
      }
    });
  }

  tieneGenero(genero: string): boolean { return this.generosSeleccionados().includes(genero); }

  toggleGenero(genero: string): void {
    this.generosSeleccionados.update(actual => actual.includes(genero) ? actual.filter(item => item !== genero) : [...actual, genero]);
  }

  async guardar(): Promise<void> {
    this.form.markAllAsTouched();
    this.error.set(null);
    if (this.form.invalid || !this.generosSeleccionados().length) {
      if (!this.generosSeleccionados().length) this.error.set('Elegí al menos un género.');
      return;
    }
    this.enviando.set(true);
    const pelicula: PeliculaEditable = { ...this.form.getRawValue(), generos: this.generosSeleccionados() };
    try {
      await this.servicio.guardar(pelicula, this.id());
      void this.router.navigate(['/admin/peliculas']);
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'No se pudo guardar la película.'); }
    finally { this.enviando.set(false); }
  }
}
