import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { RoleDirective } from '../../shared/directives/role.directive';

@Component({ selector: 'app-header', imports: [RouterLink, RouterLinkActive, RoleDirective], templateUrl: './header.html', styleUrl: './header.css' })
export class Header {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly menuOpen = signal(false);

  async salir(): Promise<void> {
    await this.auth.signOut();
    this.menuOpen.set(false);
    void this.router.navigate(['/']);
  }
}
