import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Recompensa, TipoRecompensa } from '../../../core/models/recompensa.interface';
import { FidelizacionService } from '../../../core/services/fidelizacion.service';

@Component({
  selector: 'app-recompensas-admin',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './recompensas-admin.html',
  styleUrl: './recompensas-admin.css'
})
export class RecompensasAdmin implements OnInit {
  readonly servicio = inject(FidelizacionService);
  private readonly fb = inject(FormBuilder);
  readonly editandoId = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100), Validators.pattern(/\S/)]],
    descripcion: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(300), Validators.pattern(/\S/)]],
    tipo: this.fb.nonNullable.control<TipoRecompensa>('entrada', Validators.required),
    producto_id: [''],
    costo_puntos: [500, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
    activo: [true]
  });

  async ngOnInit(): Promise<void> {
    await this.servicio.cargarAdministracion();
  }

  editar(recompensa: Recompensa): void {
    if (this.enviando()) return;
    this.editandoId.set(recompensa.id);
    this.limpiarMensajes();
    this.form.reset({
      nombre: recompensa.nombre,
      descripcion: recompensa.descripcion,
      tipo: recompensa.tipo,
      producto_id: recompensa.producto_id ?? '',
      costo_puntos: recompensa.costo_puntos,
      activo: recompensa.activo
    });
  }

  nuevo(): void {
    if (this.enviando()) return;
    this.editandoId.set(null);
    this.limpiarMensajes();
    this.form.reset({ nombre: '', descripcion: '', tipo: 'entrada', producto_id: '', costo_puntos: 500, activo: true });
  }

  async guardar(): Promise<void> {
    this.form.markAllAsTouched();
    this.limpiarMensajes();
    if (this.form.invalid || this.enviando()) return;
    const valores = this.form.getRawValue();
    if (valores.tipo === 'producto' && !valores.producto_id) {
      this.error.set('Elegí el producto que se entrega con la recompensa.');
      return;
    }
    this.enviando.set(true);
    try {
      const id = this.editandoId();
      await this.servicio.guardar({
        nombre: valores.nombre,
        descripcion: valores.descripcion,
        tipo: valores.tipo,
        producto_id: valores.tipo === 'producto' ? valores.producto_id : null,
        costo_puntos: Number(valores.costo_puntos),
        activo: valores.activo
      }, id ?? undefined);
      this.nuevo();
      this.mensaje.set(id ? 'Recompensa actualizada.' : 'Recompensa creada.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo guardar la recompensa.');
    } finally { this.enviando.set(false); }
  }

  tipoActual(): TipoRecompensa {
    return this.form.controls.tipo.value;
  }

  private limpiarMensajes(): void {
    this.error.set(null);
    this.mensaje.set(null);
  }
}
