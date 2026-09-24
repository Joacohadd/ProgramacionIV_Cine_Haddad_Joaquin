import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({ selector: 'app-login', imports: [ReactiveFormsModule, RouterLink], templateUrl: './login.html', styleUrl: './login.css' })
export class Login {
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({ email: ['', [Validators.required, Validators.email]], password: ['', Validators.required] });

  async ingresar(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.enviando.set(true);
    this.error.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email, password);
      const rol = this.auth.currentUserData()?.rol;
      void this.router.navigate([rol === 'admin' ? '/admin/peliculas' : rol === 'empleado' ? '/personal/validacion' : '/perfil']);
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'No se pudo ingresar.'); }
    finally { this.enviando.set(false); }
  }

  entrarDemo(): void {
    if (this.auth.ingresarDemo()) {
      void this.router.navigate([this.auth.currentUserData()?.rol === 'empleado' ? '/personal/validacion' : '/perfil']);
    }
    else this.error.set('Primero creá un perfil de muestra.');
  }

  entrarAdminDemo(): void {
    this.auth.ingresarAdminDemo();
    void this.router.navigate(['/admin/peliculas']);
  }

  entrarEmpleadoDemo(): void {
    this.auth.ingresarEmpleadoDemo();
    void this.router.navigate(['/personal/validacion']);
  }
}
