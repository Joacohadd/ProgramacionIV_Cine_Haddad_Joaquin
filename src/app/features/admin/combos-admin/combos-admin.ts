import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ComboCandy } from '../../../core/models/combo-candy.interface';
import { ComboCandyService } from '../../../core/services/combo-candy.service';

@Component({
  selector: 'app-combos-admin',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './combos-admin.html',
  styleUrl: './combos-admin.css'
})
export class CombosAdmin implements OnInit {
  readonly servicio = inject(ComboCandyService);
  private readonly fb = inject(FormBuilder);
  readonly editandoId = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100), Validators.pattern(/\S/)]],
    descripcion: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(300), Validators.pattern(/\S/)]],
    pochoclos_producto_id: ['', Validators.required],
    bebida_producto_id: ['', Validators.required],
    precio: this.fb.control<number | null>(null, [Validators.required, Validators.min(0.01), Validators.max(21474836.47), Validators.pattern(/^\d+(?:\.\d{1,2})?$/)]),
    activo: [true]
  });

  async ngOnInit(): Promise<void> {
    await this.servicio.productos.cargar();
    await this.servicio.cargar();
  }

  editar(combo: ComboCandy): void {
    if (this.enviando()) return;
    this.editandoId.set(combo.id);
    this.error.set(null);
    this.mensaje.set(null);
    this.form.reset({
      nombre: combo.nombre,
      descripcion: combo.descripcion,
      pochoclos_producto_id: combo.pochoclos_producto_id,
      bebida_producto_id: combo.bebida_producto_id,
      precio: combo.precio_centavos / 100,
      activo: combo.activo
    });
  }

  nuevo(): void {
    if (this.enviando()) return;
    this.editandoId.set(null);
    this.error.set(null);
    this.mensaje.set(null);
    this.form.reset({ nombre: '', descripcion: '', pochoclos_producto_id: '', bebida_producto_id: '', precio: null, activo: true });
  }

  async guardar(): Promise<void> {
    if (this.enviando()) return;
    this.form.markAllAsTouched();
    this.error.set(null);
    this.mensaje.set(null);
    if (this.form.invalid) return;
    const valores = this.form.getRawValue();
    if (valores.precio === null) return;
    this.enviando.set(true);
    try {
      const id = this.editandoId();
      await this.servicio.guardar({
        nombre: valores.nombre,
        descripcion: valores.descripcion,
        pochoclos_producto_id: valores.pochoclos_producto_id,
        bebida_producto_id: valores.bebida_producto_id,
        precio_centavos: Math.round(valores.precio * 100),
        activo: valores.activo
      }, id ?? undefined);
      this.nuevo();
      this.mensaje.set(id ? 'Combo actualizado.' : 'Combo creado.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo guardar el combo.');
    } finally { this.enviando.set(false); }
  }

  async cambiarPublicacion(combo: ComboCandy): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      const activo = !combo.activo;
      await this.servicio.cambiarPublicacion(combo.id, activo);
      if (this.editandoId() === combo.id) this.form.controls.activo.setValue(activo);
      this.mensaje.set(activo ? 'Combo destacado en la compra.' : 'Combo ocultado de la compra.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo cambiar la publicación.');
    } finally { this.enviando.set(false); }
  }

  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(centavos / 100);
  }
}
