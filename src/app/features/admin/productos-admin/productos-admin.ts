import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Producto } from '../../../core/models/producto.interface';
import { ProductoService } from '../../../core/services/producto.service';

@Component({
  selector: 'app-productos-admin',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './productos-admin.html',
  styleUrl: './productos-admin.css'
})
export class ProductosAdmin implements OnInit {
  readonly servicio = inject(ProductoService);
  private readonly fb = inject(FormBuilder);
  readonly editandoId = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly enviandoCategoria = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100), Validators.pattern(/\S/)]],
    descripcion: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(500), Validators.pattern(/\S/)]],
    categoria_id: ['', Validators.required],
    // El formulario usa pesos; la base guarda centavos enteros.
    precio: this.fb.control<number | null>(null, [Validators.required, Validators.min(0.01), Validators.max(21474836.47), Validators.pattern(/^\d+(?:\.\d{1,2})?$/)]),
    imagen_url: ['', Validators.pattern(/^https:\/\/\S+$/)],
    activo: [true]
  });

  readonly categoriaForm = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60), Validators.pattern(/\S/)]]
  });

  ngOnInit(): void { void this.servicio.cargar(); }

  editar(producto: Producto): void {
    if (this.enviando() || this.enviandoCategoria()) return;
    this.editandoId.set(producto.id);
    this.error.set(null);
    this.mensaje.set(null);
    this.form.reset({
      nombre: producto.nombre, descripcion: producto.descripcion,
      categoria_id: producto.categoria_id,
      precio: producto.precio_centavos / 100, imagen_url: producto.imagen_url, activo: producto.activo
    });
  }

  nuevo(): void {
    if (this.enviando() || this.enviandoCategoria()) return;
    this.limpiarFormulario();
    this.error.set(null);
    this.mensaje.set(null);
  }

  async guardar(): Promise<void> {
    if (this.enviando() || this.enviandoCategoria()) return;
    this.form.markAllAsTouched();
    this.error.set(null);
    this.mensaje.set(null);
    if (this.form.invalid) return;
    const { nombre, descripcion, categoria_id, precio, imagen_url, activo } = this.form.getRawValue();
    if (precio === null) return;
    this.enviando.set(true);
    try {
      const editandoId = this.editandoId();
      await this.servicio.guardar({
        nombre, descripcion, categoria_id, precio_centavos: Math.round(precio * 100), imagen_url, activo
      }, editandoId ?? undefined);
      this.limpiarFormulario();
      this.mensaje.set(editandoId ? 'Producto actualizado.' : 'Producto creado.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo guardar el producto.');
    } finally { this.enviando.set(false); }
  }

  async cambiarPublicacion(producto: Producto): Promise<void> {
    if (this.enviando() || this.enviandoCategoria()) return;
    this.enviando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      const activo = !producto.activo;
      await this.servicio.cambiarPublicacion(producto.id, activo);
      if (this.editandoId() === producto.id) this.form.controls.activo.setValue(activo);
      this.mensaje.set(activo ? 'Producto publicado en el candy bar.' : 'Producto retirado del catálogo público.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo cambiar la publicación.');
    } finally { this.enviando.set(false); }
  }

  async crearCategoria(): Promise<void> {
    if (this.enviando() || this.enviandoCategoria()) return;
    this.categoriaForm.markAllAsTouched();
    this.error.set(null);
    this.mensaje.set(null);
    if (this.categoriaForm.invalid) return;
    this.enviandoCategoria.set(true);
    try {
      await this.servicio.crearCategoria(this.categoriaForm.controls.nombre.value);
      this.categoriaForm.reset();
      this.mensaje.set('Categoría creada. Ya podés asignarla a un producto.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo crear la categoría.');
    } finally { this.enviandoCategoria.set(false); }
  }

  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(centavos / 100);
  }

  private limpiarFormulario(): void {
    this.editandoId.set(null);
    this.form.reset({ nombre: '', descripcion: '', categoria_id: '', precio: null, imagen_url: '', activo: true });
  }
}
