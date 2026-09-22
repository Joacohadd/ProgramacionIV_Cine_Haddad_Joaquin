import { CodigoQrCompra } from '../models/retiro-candy.interface';

export function parsearCodigoQr(contenido: string): CodigoQrCompra | null {
  const partes = contenido.trim().split('|');
  if (partes.length !== 3 || partes[0].toLocaleUpperCase() !== 'UMBRAL') return null;
  const codigo = partes[1].trim().toLocaleUpperCase();
  const token = partes[2].trim().toLocaleLowerCase();
  if (!/^UMB-[A-Z0-9]{10}$/.test(codigo)) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) return null;
  return { codigo, token };
}
