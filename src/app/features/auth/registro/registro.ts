import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({ selector: 'app-registro', imports: [ReactiveFormsModule, RouterLink], templateUrl: './registro.html', styleUrl: './registro.css' })
export class Registro {
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly hoy = new Date().toISOString().slice(0, 10);
  readonly tiposSangre = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  readonly coloresOjos = ['Marrón', 'Negro', 'Verde', 'Azul', 'Gris', 'Avellana', 'Otro'];
  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    apellido: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    email: ['', [Validators.required, Validators.email]],
    fecha_nacimiento: ['', [Validators.required]],
    tipo_sangre: ['', [Validators.required]],
    color_ojos: ['', [Validators.required]],
    dias_vacaciones: [0, [Validators.required, Validators.min(0), Validators.max(365)]],
    password: ['', [Validators.required, Validators.minLength(8)]]
  });

  async enviar(): Promise<void> {
    this.form.markAllAsTouched();
    this.error.set(null);
    if (this.form.invalid) return;
    const datos = this.form.getRawValue();
    if (datos.fecha_nacimiento > this.hoy) { this.error.set('La fecha de nacimiento no puede estar en el futuro.'); return; }
    this.enviando.set(true);
    try {
      const resultado = await this.auth.signUp(datos);
      if (resultado.pendingConfirmation) {
        this.mensaje.set('Cuenta creada. Revisá tu correo para confirmarla antes de ingresar.');
        this.form.reset();
      } else {
        void this.router.navigate(['/perfil']);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo crear la cuenta.');
    } finally { this.enviando.set(false); }
  }
}
