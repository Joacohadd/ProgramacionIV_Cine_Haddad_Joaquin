import { Clasificacion } from '../models/pelicula.interface';

export const HORAS_LIMITE_CANCELACION = 2;

export function edadEnFecha(fechaNacimiento: string, fechaReferencia: string): number {
  const [anioNacimiento, mesNacimiento, diaNacimiento] = fechaNacimiento.split('-').map(Number);
  const [anioReferencia, mesReferencia, diaReferencia] = fechaReferencia.split('-').map(Number);
  if (![anioNacimiento, mesNacimiento, diaNacimiento, anioReferencia, mesReferencia, diaReferencia].every(Number.isFinite)) {
    return -1;
  }

  let edad = anioReferencia - anioNacimiento;
  if (mesReferencia < mesNacimiento || (mesReferencia === mesNacimiento && diaReferencia < diaNacimiento)) edad--;
  return edad;
}

export function edadMinima(clasificacion: Clasificacion): number {
  return clasificacion === 'ATP' ? 0 : Number(clasificacion);
}

export function cumpleRestriccionEdad(
  fechaNacimiento: string,
  fechaFuncion: string,
  clasificacion: Clasificacion
): boolean {
  return edadEnFecha(fechaNacimiento, fechaFuncion) >= edadMinima(clasificacion);
}

export function fechaHoraFuncion(fecha: string, hora: string): Date {
  const horaNormalizada = hora.length === 5 ? `${hora}:00` : hora;
  return new Date(`${fecha}T${horaNormalizada}`);
}

export function puedeCancelarCompra(fecha: string, hora: string, ahora = new Date()): boolean {
  const inicio = fechaHoraFuncion(fecha, hora).getTime();
  return Number.isFinite(inicio) && inicio - ahora.getTime() >= HORAS_LIMITE_CANCELACION * 60 * 60 * 1000;
}
