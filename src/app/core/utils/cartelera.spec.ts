import { describe, expect, it } from 'vitest';
import { PELICULAS_DEMO } from '../data/peliculas-demo';
import { filtrarYOrdenarCartelera } from './cartelera';

describe('cartelera pública', () => {
  it('ubica primero las tres más vendidas y nunca muestra ocultas', () => {
    const oculta = { ...PELICULAS_DEMO[0], id: 'oculta', entradas_vendidas: 9999, visible_inicio: false };
    const resultado = filtrarYOrdenarCartelera([...PELICULAS_DEMO, oculta], '', 'Todos');
    expect(resultado.slice(0, 3).map(p => p.titulo)).toEqual(['La última luz', 'Mareas de vidrio', 'Órbita cero']);
    expect(resultado.find(p => p.id === 'oculta')).toBeUndefined();
  });

  it('encuentra un género múltiple y combina género con texto', () => {
    const misterio = filtrarYOrdenarCartelera(PELICULAS_DEMO, '', 'Misterio');
    expect(misterio.map(p => p.titulo)).toEqual(['La última luz', 'El ruido del agua', 'Después del eclipse']);
    const combinado = filtrarYOrdenarCartelera(PELICULAS_DEMO, 'agua', 'Misterio');
    expect(combinado.map(p => p.titulo)).toEqual(['El ruido del agua']);
    expect(filtrarYOrdenarCartelera(PELICULAS_DEMO, 'agua', 'Romance')).toEqual([]);
  });
});
