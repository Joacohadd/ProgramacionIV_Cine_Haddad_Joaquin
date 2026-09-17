import { Directive, effect, inject, Input, signal, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

// Directiva estructural equivalente a la vista en clase 6.
@Directive({ selector: '[appRole]' })
export class RoleDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);
  private readonly requiredRole = signal('');

  @Input() set appRole(role: string) { this.requiredRole.set(role); }

  constructor() {
    effect(() => {
      this.container.clear();
      if (this.auth.currentUserData()?.rol === this.requiredRole()) this.container.createEmbeddedView(this.template);
    });
  }
}
