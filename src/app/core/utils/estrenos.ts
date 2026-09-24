import { Pelicula } from '../models/pelicula.interface';

export const DIAS_ANTICIPACION_PREVENTA = 7;

export function desplazarFechaISO(fechaISO: string, dias: number): string {
  const fecha = new Date(`${fechaISO}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

export function inicioPreventa(pelicula: Pick<Pelicula, 'fecha_estreno'>): string {
  return desplazarFechaISO(pelicula.fecha_estreno, -DIAS_ANTICIPACION_PREVENTA);
}

export function preventaActiva(
  pelicula: Pick<Pelicula, 'fecha_estreno' | 'preventa_habilitada' | 'precio_preventa_centavos'>,
  fechaActual: string
): boolean {
  return pelicula.preventa_habilitada
    && Boolean(pelicula.precio_preventa_centavos)
    && fechaActual >= inicioPreventa(pelicula)
    && fechaActual < pelicula.fecha_estreno;
}

export function ventaHabilitada(
  pelicula: Pick<Pelicula, 'fecha_estreno' | 'preventa_habilitada' | 'precio_preventa_centavos'>,
  fechaActual: string
): boolean {
  return fechaActual >= pelicula.fecha_estreno || preventaActiva(pelicula, fechaActual);
}

export function precioBaseVigente(
  pelicula: Pick<Pelicula, 'fecha_estreno' | 'preventa_habilitada' | 'precio_preventa_centavos'>,
  fechaActual: string,
  precioNormalCentavos: number
): number {
  return preventaActiva(pelicula, fechaActual)
    ? pelicula.precio_preventa_centavos ?? precioNormalCentavos
    : precioNormalCentavos;
}
