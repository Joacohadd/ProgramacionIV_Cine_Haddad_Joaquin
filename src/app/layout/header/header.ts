import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { RoleDirective } from '../../shared/directives/role.directive';

@Component({ selector: 'app-header', imports: [RouterLink, RouterLinkActive, RoleDirective], templateUrl: './header.html', styleUrl: './header.css' })
export class Header {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  readonly menuOpen = signal(false);
  readonly adminOpen = signal(false);

  cerrarNavegacion(): void {
    this.adminOpen.set(false);
    this.menuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  cerrarAdminSiExterno(event: MouseEvent): void {
    if (!this.adminOpen()) return;
    const desplegable = this.element.nativeElement.querySelector('.admin-nav');
    if (!(event.target instanceof Node) || !desplegable?.contains(event.target)) {
      this.adminOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  cerrarAdminConEscape(): void {
    if (!this.adminOpen()) return;
    this.adminOpen.set(false);
    this.element.nativeElement.querySelector<HTMLButtonElement>('.admin-trigger')?.focus();
  }

  async salir(): Promise<void> {
    await this.auth.signOut();
    this.cerrarNavegacion();
    void this.router.navigate(['/']);
  }
}
