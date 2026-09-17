import { Pelicula } from '../models/pelicula.interface';
import { FuncionDetalle, FuncionEditable, Sala } from '../models/programacion.interface';

const MINUTOS_DIA = 24 * 60;
const MINUTOS_SEMANA = 7 * MINUTOS_DIA;
export const MARGEN_ENTRE_FUNCIONES = 30;

function minutosHora(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

export function capacidadSala(sala: Pick<Sala, 'filas' | 'butacas_izquierda' | 'butacas_centro' | 'butacas_derecha'>): number {
  return sala.filas * (sala.butacas_izquierda + sala.butacas_centro + sala.butacas_derecha);
}

export function horaFin(horaInicio: string, duracionMinutos: number): string {
  const total = minutosHora(horaInicio) + duracionMinutos;
  const horas = Math.floor((total % MINUTOS_DIA) / 60).toString().padStart(2, '0');
  const minutos = (total % 60).toString().padStart(2, '0');
  return `${horas}:${minutos}${total >= MINUTOS_DIA ? ' +1' : ''}`;
}

export function funcionesSeSuperponen(
  primera: Pick<FuncionEditable, 'fecha_desde' | 'fecha_hasta' | 'dias_semana' | 'hora_inicio'>,
  duracionPrimera: number,
  segunda: Pick<FuncionEditable, 'fecha_desde' | 'fecha_hasta' | 'dias_semana' | 'hora_inicio'>,
  duracionSegunda: number
): boolean {
  const fechasCoinciden = primera.fecha_desde <= segunda.fecha_hasta && segunda.fecha_desde <= primera.fecha_hasta;
  if (!fechasCoinciden) return false;

  return primera.dias_semana.some(diaPrimera => segunda.dias_semana.some(diaSegunda => {
    const inicioPrimera = (diaPrimera - 1) * MINUTOS_DIA + minutosHora(primera.hora_inicio);
    const finPrimera = inicioPrimera + duracionPrimera + MARGEN_ENTRE_FUNCIONES;
    const inicioBaseSegunda = (diaSegunda - 1) * MINUTOS_DIA + minutosHora(segunda.hora_inicio);

    return [-MINUTOS_SEMANA, 0, MINUTOS_SEMANA].some(desplazamiento => {
      const inicioSegunda = inicioBaseSegunda + desplazamiento;
      const finSegunda = inicioSegunda + duracionSegunda + MARGEN_ENTRE_FUNCIONES;
      return inicioPrimera < finSegunda && inicioSegunda < finPrimera;
    });
  }));
}

export function buscarSalaDisponible(
  salas: Sala[],
  funciones: FuncionDetalle[],
  peliculas: Pelicula[],
  nueva: FuncionEditable,
  excluirId?: string,
  salaPreferida?: string
): Sala | undefined {
  const pelicula = peliculas.find(item => item.id === nueva.pelicula_id);
  if (!pelicula) return undefined;

  return salas
    .filter(sala => sala.activa && sala.formatos.includes(nueva.formato))
    .sort((a, b) => Number(b.id === salaPreferida) - Number(a.id === salaPreferida) || a.nombre.localeCompare(b.nombre))
    .find(sala => !funciones.some(funcion =>
      funcion.id !== excluirId &&
      funcion.activa &&
      funcion.sala_id === sala.id &&
      funcionesSeSuperponen(nueva, pelicula.duracion_minutos, funcion, funcion.duracion_minutos)
    ));
}
