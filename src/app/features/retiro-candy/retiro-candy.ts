import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RetiroCandyService } from '../../core/services/retiro-candy.service';

@Component({
  selector: 'app-retiro-candy',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './retiro-candy.html',
  styleUrl: './retiro-candy.css'
})
export class RetiroCandyComponent {
  readonly servicio = inject(RetiroCandyService);
  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.nonNullable.group({
    contenido: ['', [Validators.required, Validators.pattern(/^UMBRAL\|UMB-[A-Z0-9]{10}\|[0-9a-fA-F-]{36}$/)]]
  });

  async consultar(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    await this.servicio.consultar(this.form.controls.contenido.value);
  }

  fecha(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(`${fecha}T00:00:00Z`));
  }

  horaRetiro(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(fecha));
  }
}
