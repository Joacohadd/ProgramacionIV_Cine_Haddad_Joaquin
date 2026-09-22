import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';
import { authGuard } from './core/guards/auth.guard';
import { personalGuard } from './core/guards/personal.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home').then(c => c.Home) },
  { path: 'candy', loadComponent: () => import('./features/candy/candy').then(c => c.Candy) },
  { path: 'pelicula/:id', loadComponent: () => import('./features/pelicula-detalle/pelicula-detalle').then(c => c.PeliculaDetalle) },
  { path: 'funcion/:id/butacas', loadComponent: () => import('./features/seleccion-butacas/seleccion-butacas').then(c => c.SeleccionButacas) },
  { path: 'funcion/:id/compra/:fecha', loadComponent: () => import('./features/checkout/checkout').then(c => c.Checkout) },
  { path: 'registro', loadComponent: () => import('./features/auth/registro/registro').then(c => c.Registro) },
  { path: 'login', loadComponent: () => import('./features/auth/login/login').then(c => c.Login) },
  { path: 'perfil', canActivate: [authGuard], loadComponent: () => import('./features/perfil/perfil').then(c => c.PerfilComponent) },
  { path: 'personal/retiro-candy', canActivate: [personalGuard], loadComponent: () => import('./features/retiro-candy/retiro-candy').then(c => c.RetiroCandyComponent) },
  { path: 'admin/peliculas', canActivate: [adminGuard], loadComponent: () => import('./features/admin/peliculas-admin/peliculas-admin').then(c => c.PeliculasAdmin) },
  { path: 'admin/peliculas/nueva', canActivate: [adminGuard], loadComponent: () => import('./features/admin/pelicula-form/pelicula-form').then(c => c.PeliculaForm) },
  { path: 'admin/peliculas/:id', canActivate: [adminGuard], loadComponent: () => import('./features/admin/pelicula-form/pelicula-form').then(c => c.PeliculaForm) },
  { path: 'admin/programacion', canActivate: [adminGuard], loadComponent: () => import('./features/admin/programacion-admin/programacion-admin').then(c => c.ProgramacionAdmin) },
  { path: 'admin/productos', canActivate: [adminGuard], loadComponent: () => import('./features/admin/productos-admin/productos-admin').then(c => c.ProductosAdmin) },
  { path: 'admin/combos', canActivate: [adminGuard], loadComponent: () => import('./features/admin/combos-admin/combos-admin').then(c => c.CombosAdmin) },
  { path: '**', redirectTo: '' }
];
