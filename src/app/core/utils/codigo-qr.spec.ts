import { describe, expect, it } from 'vitest';
import { parsearCodigoQr } from './codigo-qr';

describe('código QR de compra', () => {
  it('extrae el código y token del contenido generado en la entrada', () => {
    expect(parsearCodigoQr('UMBRAL|UMB-AB12CD34EF|550e8400-e29b-41d4-a716-446655440000')).toEqual({
      codigo: 'UMB-AB12CD34EF', token: '550e8400-e29b-41d4-a716-446655440000'
    });
  });

  it('rechaza contenidos incompletos o ajenos al cine', () => {
    expect(parsearCodigoQr('UMB-AB12CD34EF')).toBeNull();
    expect(parsearCodigoQr('OTRO|UMB-AB12CD34EF|550e8400-e29b-41d4-a716-446655440000')).toBeNull();
  });
});
