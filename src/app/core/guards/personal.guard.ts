import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const personalGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const rol = (await auth.perfilActual())?.rol;
  return rol === 'empleado' || rol === 'admin' ? true : router.createUrlTree(['/']);
};
