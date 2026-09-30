import { describe, expect, it } from 'vitest';
import { Sala } from '../models/programacion.interface';
import { generarMapaButacas, PRECIO_BUTACA_CENTAVOS, RECARGO_VIP_CENTAVOS } from './butacas';

const sala: Sala = {
  id: 'sala-1', nombre: 'Sala', filas: 20,
  butacas_izquierda: 4, butacas_centro: 20, butacas_derecha: 4,
  formatos: ['2D'], activa: true
};

describe('mapa de butacas', () => {
  it('respeta la distribución general de tres bloques', () => {
    const filaA = generarMapaButacas(sala)[0];
    expect(filaA.sectores.map(sector => sector.length)).toEqual([4, 20, 4]);
    expect(filaA.sectores.flat()).toHaveLength(28);
  });

  it('excluye K y mantiene J como fila accesible', () => {
    const mapa = generarMapaButacas(sala);
    expect(mapa.map(fila => fila.etiqueta)).not.toContain('K');
    expect(mapa).toHaveLength(19);
    expect(mapa[9].tipo).toBe('accesible');
    expect(mapa[9].sectores.map(sector => sector.length)).toEqual([2, 10, 2]);
  });

  it('marca R, S y T como VIP y aplica el precio diferencial', () => {
    const mapa = generarMapaButacas(sala);
    for (const indice of [16, 17, 18]) {
      const butacas = mapa[indice].sectores.flat();
      expect(mapa[indice].tipo).toBe('vip');
      expect(butacas[0].precio_centavos).toBe(PRECIO_BUTACA_CENTAVOS + RECARGO_VIP_CENTAVOS);
    }
  });
});
