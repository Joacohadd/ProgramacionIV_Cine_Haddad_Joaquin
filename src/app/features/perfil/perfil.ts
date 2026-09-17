import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({ selector: 'app-perfil', imports: [RouterLink], templateUrl: './perfil.html', styleUrl: './perfil.css' })
export class PerfilComponent {
  readonly auth = inject(AuthService);
  readonly credito = computed(() => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format((this.auth.currentUserData()?.credito_centavos ?? 0) / 100));
  readonly nacimiento = computed(() => {
    const fecha = this.auth.currentUserData()?.fecha_nacimiento;
    return fecha ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${fecha}T00:00:00Z`)) : '';
  });
}
