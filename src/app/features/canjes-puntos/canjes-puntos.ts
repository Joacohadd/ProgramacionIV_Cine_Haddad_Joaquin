import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CanjesPuntosPersonalService } from '../../core/services/canjes-puntos-personal.service';

@Component({
  selector: 'app-canjes-puntos',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './canjes-puntos.html',
  styleUrl: './canjes-puntos.css'
})
export class CanjesPuntos implements OnInit {
  readonly servicio = inject(CanjesPuntosPersonalService);
  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.nonNullable.group({
    codigo: ['', [Validators.required, Validators.pattern(/^CAN-[A-Z0-9]{10}$/)]]
  });

  ngOnInit(): void { void this.servicio.cargarRecientes(); }

  normalizarCodigo(): void {
    const control = this.form.controls.codigo;
    const normalizado = control.value.toUpperCase().replace(/\s/g, '');
    if (normalizado !== control.value) control.setValue(normalizado);
    this.servicio.limpiar();
  }

  async consultar(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    await this.servicio.consultar(this.form.controls.codigo.value);
  }

  async elegir(codigo: string): Promise<void> {
    this.form.controls.codigo.setValue(codigo);
    await this.servicio.consultar(codigo);
  }

  fechaHora(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires'
    }).format(new Date(fecha));
  }
}
