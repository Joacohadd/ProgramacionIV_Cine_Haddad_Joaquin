import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  DIAS_SEMANA, DiaSemana, FORMATOS_PROYECCION, FormatoProyeccion,
  FuncionDetalle, IdiomaFuncion, Sala
} from '../../../core/models/programacion.interface';
import { PeliculaService } from '../../../core/services/pelicula.service';
import { ProgramacionService } from '../../../core/services/programacion.service';
import { capacidadSala, horaFin } from '../../../core/utils/planificacion';

@Component({
  selector: 'app-programacion-admin',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './programacion-admin.html',
  styleUrl: './programacion-admin.css'
})
export class ProgramacionAdmin {
  readonly servicio = inject(ProgramacionService);
  readonly peliculasServicio = inject(PeliculaService);
  private readonly fb = inject(FormBuilder);
  readonly dias = DIAS_SEMANA;
  readonly formatos = FORMATOS_PROYECCION;
  readonly diasSeleccionados = signal<DiaSemana[]>([]);
  readonly formatosSeleccionados = signal<FormatoProyeccion[]>(['2D']);
  readonly funcionEditando = signal<string | null>(null);
  readonly salaEditando = signal<string | null>(null);
  readonly guardandoFuncion = signal(false);
  readonly guardandoSala = signal(false);
  readonly errorFuncion = signal<string | null>(null);
  readonly errorSala = signal<string | null>(null);
  readonly mensajeFuncion = signal<string | null>(null);
  readonly mensajeSala = signal<string | null>(null);
  readonly funcionesActivas = computed(() => this.servicio.funciones().filter(funcion => funcion.activa).length);
  readonly salasActivas = computed(() => this.servicio.salas().filter(sala => sala.activa).length);

  readonly funcionForm = this.fb.nonNullable.group({
    pelicula_id: ['', Validators.required],
    fecha_desde: [this.fechaISO(0), Validators.required],
    fecha_hasta: [this.fechaISO(30), Validators.required],
    hora_inicio: ['18:00', Validators.required],
    formato: ['2D' as FormatoProyeccion, Validators.required],
    idioma: ['Castellano' as IdiomaFuncion, Validators.required],
    activa: [true]
  });

  readonly salaForm = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    filas: [20, [Validators.required, Validators.min(1), Validators.max(40)]],
    butacas_izquierda: [4, [Validators.required, Validators.min(1), Validators.max(50)]],
    butacas_centro: [20, [Validators.required, Validators.min(1), Validators.max(50)]],
    butacas_derecha: [4, [Validators.required, Validators.min(1), Validators.max(50)]],
    activa: [true]
  });

  private fechaISO(diasDesdeHoy: number): string {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + diasDesdeHoy);
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  }

  toggleDia(dia: DiaSemana): void {
    this.diasSeleccionados.update(actual => actual.includes(dia)
      ? actual.filter(item => item !== dia)
      : [...actual, dia].sort((a, b) => a - b));
  }

  toggleFormato(formato: FormatoProyeccion): void {
    this.formatosSeleccionados.update(actual => actual.includes(formato)
      ? actual.filter(item => item !== formato)
      : [...actual, formato]);
  }

  async guardarFuncion(): Promise<void> {
    this.funcionForm.markAllAsTouched();
    this.errorFuncion.set(null);
    this.mensajeFuncion.set(null);
    const valores = this.funcionForm.getRawValue();
    if (this.funcionForm.invalid) return;
    if (!this.diasSeleccionados().length) {
      this.errorFuncion.set('Elegí al menos un día de la semana.');
      return;
    }
    if (valores.fecha_hasta < valores.fecha_desde) {
      this.errorFuncion.set('La fecha final no puede ser anterior a la fecha inicial.');
      return;
    }
    this.guardandoFuncion.set(true);
    try {
      await this.servicio.guardarFuncion({ ...valores, dias_semana: this.diasSeleccionados() }, this.funcionEditando() ?? undefined);
      this.mensajeFuncion.set(this.servicio.mensaje());
      this.cancelarEdicionFuncion(false);
    } catch (error) {
      this.errorFuncion.set(error instanceof Error ? error.message : 'No se pudo guardar la programación.');
    } finally { this.guardandoFuncion.set(false); }
  }

  editarFuncion(funcion: FuncionDetalle): void {
    this.funcionEditando.set(funcion.id);
    this.diasSeleccionados.set([...funcion.dias_semana]);
    this.funcionForm.patchValue(funcion);
    this.errorFuncion.set(null);
    this.mensajeFuncion.set(null);
    document.querySelector('.function-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  cancelarEdicionFuncion(limpiarMensaje = true): void {
    this.funcionEditando.set(null);
    this.diasSeleccionados.set([]);
    this.funcionForm.reset({
      pelicula_id: '', fecha_desde: this.fechaISO(0), fecha_hasta: this.fechaISO(30),
      hora_inicio: '18:00', formato: '2D', idioma: 'Castellano', activa: true
    });
    this.errorFuncion.set(null);
    if (limpiarMensaje) this.mensajeFuncion.set(null);
  }

  async eliminarFuncion(funcion: FuncionDetalle): Promise<void> {
    if (!confirm(`¿Eliminar la programación de “${funcion.pelicula_titulo}”?`)) return;
    try {
      await this.servicio.eliminarFuncion(funcion.id);
      this.mensajeFuncion.set(this.servicio.mensaje());
      if (this.funcionEditando() === funcion.id) this.cancelarEdicionFuncion(false);
    } catch (error) {
      this.errorFuncion.set(error instanceof Error ? error.message : 'No se pudo eliminar la programación.');
    }
  }

  async guardarSala(): Promise<void> {
    this.salaForm.markAllAsTouched();
    this.errorSala.set(null);
    this.mensajeSala.set(null);
    if (this.salaForm.invalid) return;
    if (!this.formatosSeleccionados().length) {
      this.errorSala.set('Elegí al menos un formato compatible.');
      return;
    }
    this.guardandoSala.set(true);
    try {
      await this.servicio.guardarSala(
        { ...this.salaForm.getRawValue(), formatos: this.formatosSeleccionados() },
        this.salaEditando() ?? undefined
      );
      this.mensajeSala.set(this.servicio.mensaje());
      this.cancelarEdicionSala(false);
    } catch (error) {
      this.errorSala.set(error instanceof Error ? error.message : 'No se pudo guardar la sala.');
    } finally { this.guardandoSala.set(false); }
  }

  editarSala(sala: Sala): void {
    this.salaEditando.set(sala.id);
    this.formatosSeleccionados.set([...sala.formatos]);
    this.salaForm.patchValue(sala);
    this.errorSala.set(null);
    this.mensajeSala.set(null);
    document.querySelector('.room-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  cancelarEdicionSala(limpiarMensaje = true): void {
    this.salaEditando.set(null);
    this.formatosSeleccionados.set(['2D']);
    this.salaForm.reset({ nombre: '', filas: 20, butacas_izquierda: 4, butacas_centro: 20, butacas_derecha: 4, activa: true });
    this.errorSala.set(null);
    if (limpiarMensaje) this.mensajeSala.set(null);
  }

  diasTexto(funcion: FuncionDetalle): string {
    return funcion.dias_semana.map(valor => this.dias.find(dia => dia.valor === valor)?.corto).join(' · ');
  }

  horaFinal(funcion: FuncionDetalle): string { return horaFin(funcion.hora_inicio, funcion.duracion_minutos); }
  capacidad(sala: Sala): number { return capacidadSala(sala); }

  fechaCorta(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${fecha}T00:00:00Z`));
  }
}
