import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Compra } from '../../core/models/compra.interface';
import { AuthService } from '../../core/services/auth.service';
import { CompraService } from '../../core/services/compra.service';

@Component({ selector: 'app-perfil', imports: [RouterLink], templateUrl: './perfil.html', styleUrl: './perfil.css' })
export class PerfilComponent {
  readonly auth = inject(AuthService);
  readonly compras = inject(CompraService);
  readonly errorDocumento = signal<string | null>(null);
  readonly credito = computed(() => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format((this.auth.currentUserData()?.credito_centavos ?? 0) / 100));
  readonly nacimiento = computed(() => {
    const fecha = this.auth.currentUserData()?.fecha_nacimiento;
    return fecha ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${fecha}T00:00:00Z`)) : '';
  });

  constructor() {
    effect(() => {
      if (this.auth.currentUserData()?.id) void this.compras.cargarCompras();
    });
  }

  async descargar(compra: Compra): Promise<void> {
    this.errorDocumento.set(null);
    try { await this.compras.descargarEntrada(compra); }
    catch { this.errorDocumento.set('No se pudo generar el PDF. Intentá nuevamente.'); }
  }

  async cancelar(compra: Compra): Promise<void> {
    try { await this.compras.cancelar(compra); } catch { /* El servicio muestra el error. */ }
  }

  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 0
    }).format(centavos / 100);
  }

  fechaFuncion(compra: Compra): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(`${compra.fecha_funcion}T00:00:00Z`));
  }
}
