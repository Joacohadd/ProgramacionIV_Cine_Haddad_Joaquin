import { describe, expect, it } from 'vitest';
import { PELICULAS_DEMO } from '../data/peliculas-demo';
import { FuncionDetalle, FuncionEditable, Sala } from '../models/programacion.interface';
import { buscarSalaDisponible, capacidadSala, funcionesSeSuperponen, horaFin, proximasFechasFuncion } from './planificacion';

const base: FuncionEditable = {
  pelicula_id: 'demo-1', fecha_desde: '2026-09-01', fecha_hasta: '2026-10-31',
  dias_semana: [1], hora_inicio: '18:00', formato: '2D', idioma: 'Castellano', activa: true
};

describe('planificación de funciones', () => {
  it('exige 30 minutos libres después del final de una película', () => {
    expect(funcionesSeSuperponen(base, 120, { ...base, hora_inicio: '20:29' }, 90)).toBe(true);
    expect(funcionesSeSuperponen(base, 120, { ...base, hora_inicio: '20:30' }, 90)).toBe(false);
  });

  it('detecta cruces que continúan después de medianoche', () => {
    const nocturna = { ...base, dias_semana: [1] as [1], hora_inicio: '23:00' };
    const madrugada = { ...base, dias_semana: [2] as [2], hora_inicio: '01:00' };
    expect(funcionesSeSuperponen(nocturna, 120, madrugada, 90)).toBe(true);
  });

  it('asigna una sala compatible que esté libre', () => {
    const salas: Sala[] = [
      { id: 's1', nombre: 'Sala 1', filas: 20, butacas_izquierda: 4, butacas_centro: 20, butacas_derecha: 4, formatos: ['2D'], activa: true },
      { id: 's2', nombre: 'Sala 2', filas: 20, butacas_izquierda: 4, butacas_centro: 20, butacas_derecha: 4, formatos: ['2D', '3D'], activa: true }
    ];
    const ocupada: FuncionDetalle = {
      ...base, id: 'f1', sala_id: 's1', pelicula_titulo: 'Película', pelicula_imagen_url: '',
      duracion_minutos: 114, sala_nombre: 'Sala 1', fecha_estreno: '2026-09-01',
      preventa_habilitada: false, precio_preventa_centavos: null
    };
    expect(buscarSalaDisponible(salas, [ocupada], PELICULAS_DEMO, base)?.id).toBe('s2');
  });

  it('calcula capacidad y horario de finalización', () => {
    expect(capacidadSala({ filas: 20, butacas_izquierda: 4, butacas_centro: 20, butacas_derecha: 4 })).toBe(532);
    expect(horaFin('23:00', 120)).toBe('01:00 +1');
  });

  it('obtiene solamente las próximas fechas válidas de una programación', () => {
    expect(proximasFechasFuncion({ ...base, dias_semana: [1, 3, 5] }, '2026-09-17', 4)).toEqual([
      '2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25'
    ]);
  });
});
