import { Funcion, Sala } from '../models/programacion.interface';

export const SALAS_DEMO: Sala[] = [
  { id: 'demo-sala-1', nombre: 'Sala Horizonte', filas: 20, butacas_izquierda: 4, butacas_centro: 20, butacas_derecha: 4, formatos: ['2D', '3D'], activa: true },
  { id: 'demo-sala-2', nombre: 'Sala Prisma', filas: 20, butacas_izquierda: 4, butacas_centro: 20, butacas_derecha: 4, formatos: ['2D', '3D', '4D'], activa: true },
  { id: 'demo-sala-3', nombre: 'Sala Umbral', filas: 20, butacas_izquierda: 4, butacas_centro: 20, butacas_derecha: 4, formatos: ['2D', '5D'], activa: true }
];

export const FUNCIONES_DEMO: Funcion[] = [
  { id: 'demo-funcion-1', pelicula_id: 'demo-1', sala_id: 'demo-sala-1', fecha_desde: '2026-09-01', fecha_hasta: '2026-10-31', dias_semana: [1, 3, 5], hora_inicio: '18:00', formato: '2D', idioma: 'Castellano', activa: true },
  { id: 'demo-funcion-2', pelicula_id: 'demo-3', sala_id: 'demo-sala-2', fecha_desde: '2026-09-01', fecha_hasta: '2026-10-31', dias_semana: [1, 3, 5], hora_inicio: '18:00', formato: '3D', idioma: 'Subtitulada', activa: true },
  { id: 'demo-funcion-3', pelicula_id: 'demo-2', sala_id: 'demo-sala-1', fecha_desde: '2026-09-01', fecha_hasta: '2026-10-31', dias_semana: [2, 4, 6], hora_inicio: '20:30', formato: '2D', idioma: 'Castellano', activa: true },
  { id: 'demo-funcion-4', pelicula_id: 'demo-4', sala_id: 'demo-sala-3', fecha_desde: '2026-09-01', fecha_hasta: '2026-10-31', dias_semana: [6, 7], hora_inicio: '16:00', formato: '5D', idioma: 'Castellano', activa: true },
  { id: 'demo-funcion-5', pelicula_id: 'demo-7', sala_id: 'demo-sala-1', fecha_desde: '2026-09-28', fecha_hasta: '2026-11-15', dias_semana: [2, 4, 6], hora_inicio: '14:00', formato: '2D', idioma: 'Castellano', activa: true },
  { id: 'demo-funcion-6', pelicula_id: 'demo-8', sala_id: 'demo-sala-2', fecha_desde: '2026-10-15', fecha_hasta: '2026-11-30', dias_semana: [1, 3, 5], hora_inicio: '15:00', formato: '2D', idioma: 'Subtitulada', activa: true }
];
