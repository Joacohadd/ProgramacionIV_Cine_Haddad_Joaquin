import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Cupon } from '../../../core/models/cupon.interface';
import { CuponService } from '../../../core/services/cupon.service';

@Component({
  selector: 'app-cupones-admin',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './cupones-admin.html',
  styleUrl: './cupones-admin.css'
})
export class CuponesAdmin implements OnInit {
  readonly servicio = inject(CuponService);
  private readonly fb = inject(FormBuilder);
  readonly editandoId = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly primeraCompra = computed(() => this.servicio.todos().find(cupon => cupon.tipo === 'primera_compra'));
  readonly mayores = computed(() => this.servicio.todos().filter(cupon => cupon.tipo === 'mayores_50'));

  readonly primeraForm = this.fb.nonNullable.group({
    porcentaje: [20, [Validators.required, Validators.min(1), Validators.max(99), Validators.pattern(/^\d+$/)]],
    activo: [true]
  });
  readonly mayorForm = this.fb.nonNullable.group({
    codigo: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9_-]{4,24}$/)]],
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100), Validators.pattern(/\S/)]],
    porcentaje: [10, [Validators.required, Validators.min(1), Validators.max(99), Validators.pattern(/^\d+$/)]],
    activo: [true]
  });

  async ngOnInit(): Promise<void> {
    await this.servicio.cargarAdministracion();
    const primera = this.primeraCompra();
    if (primera) this.primeraForm.reset({ porcentaje: primera.porcentaje, activo: primera.activo });
  }

  async guardarPrimeraCompra(): Promise<void> {
    this.primeraForm.markAllAsTouched();
    this.limpiarMensajes();
    if (this.primeraForm.invalid || this.enviando()) return;
    this.enviando.set(true);
    try {
      const valores = this.primeraForm.getRawValue();
      await this.servicio.configurarPrimeraCompra(Number(valores.porcentaje), valores.activo);
      this.mensaje.set('Beneficio de primera compra actualizado.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo actualizar el beneficio.');
    } finally { this.enviando.set(false); }
  }

  editar(cupon: Cupon): void {
    if (this.enviando()) return;
    this.editandoId.set(cupon.id);
    this.limpiarMensajes();
    this.mayorForm.reset({
      codigo: cupon.codigo,
      nombre: cupon.nombre,
      porcentaje: cupon.porcentaje,
      activo: cupon.activo
    });
  }

  nuevo(): void {
    if (this.enviando()) return;
    this.editandoId.set(null);
    this.limpiarMensajes();
    this.mayorForm.reset({ codigo: '', nombre: '', porcentaje: 10, activo: true });
  }

  async guardarMayor(): Promise<void> {
    this.mayorForm.markAllAsTouched();
    this.limpiarMensajes();
    if (this.mayorForm.invalid || this.enviando()) return;
    this.enviando.set(true);
    try {
      const valores = this.mayorForm.getRawValue();
      const id = this.editandoId();
      await this.servicio.guardar({
        codigo: valores.codigo,
        nombre: valores.nombre,
        tipo: 'mayores_50',
        porcentaje: Number(valores.porcentaje),
        activo: valores.activo
      }, id ?? undefined);
      this.nuevo();
      this.mensaje.set(id ? 'Cupón actualizado.' : 'Cupón para mayores de 50 creado.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo guardar el cupón.');
    } finally { this.enviando.set(false); }
  }

  private limpiarMensajes(): void {
    this.error.set(null);
    this.mensaje.set(null);
  }
}
