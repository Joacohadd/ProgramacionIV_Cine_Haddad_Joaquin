import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home').then(c => c.Home) },
  { path: 'pelicula/:id', loadComponent: () => import('./features/pelicula-detalle/pelicula-detalle').then(c => c.PeliculaDetalle) },
  { path: 'registro', loadComponent: () => import('./features/auth/registro/registro').then(c => c.Registro) },
  { path: 'login', loadComponent: () => import('./features/auth/login/login').then(c => c.Login) },
  { path: 'perfil', canActivate: [authGuard], loadComponent: () => import('./features/perfil/perfil').then(c => c.PerfilComponent) },
  { path: 'admin/peliculas', canActivate: [adminGuard], loadComponent: () => import('./features/admin/peliculas-admin/peliculas-admin').then(c => c.PeliculasAdmin) },
  { path: 'admin/peliculas/nueva', canActivate: [adminGuard], loadComponent: () => import('./features/admin/pelicula-form/pelicula-form').then(c => c.PeliculaForm) },
  { path: 'admin/peliculas/:id', canActivate: [adminGuard], loadComponent: () => import('./features/admin/pelicula-form/pelicula-form').then(c => c.PeliculaForm) },
  { path: 'admin/programacion', canActivate: [adminGuard], loadComponent: () => import('./features/admin/programacion-admin/programacion-admin').then(c => c.ProgramacionAdmin) },
  { path: '**', redirectTo: '' }
];
