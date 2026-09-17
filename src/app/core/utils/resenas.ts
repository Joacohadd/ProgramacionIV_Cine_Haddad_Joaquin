import { Resena } from '../models/resena.interface';

export function calcularPromedio(resenas: Resena[]): number {
  if (!resenas.length) return 0;
  const suma = resenas.reduce((total, resena) => total + resena.estrellas, 0);
  return Math.round((suma / resenas.length) * 10) / 10;
}
