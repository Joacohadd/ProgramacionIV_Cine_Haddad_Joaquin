import { Directive, effect, inject, Input, signal, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { Rol } from '../../core/models/perfil.interface';

// Directiva estructural equivalente a la vista en clase 6.
@Directive({ selector: '[appRole]' })
export class RoleDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);
  private readonly requiredRole = signal<Rol | Rol[] | ''>('');

  @Input() set appRole(role: Rol | Rol[]) { this.requiredRole.set(role); }

  constructor() {
    effect(() => {
      this.container.clear();
      const rolActual = this.auth.currentUserData()?.rol;
      const roles = this.requiredRole();
      const autorizado = Array.isArray(roles) ? Boolean(rolActual && roles.includes(rolActual)) : rolActual === roles;
      if (autorizado) this.container.createEmbeddedView(this.template);
    });
  }
}
