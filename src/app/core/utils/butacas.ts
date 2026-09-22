import { ButacaMapa, FilaButacas, SectorButaca, TipoButaca } from '../models/butaca.interface';
import { Sala } from '../models/programacion.interface';

export const PRECIO_BUTACA_CENTAVOS = 800_000;
export const RECARGO_VIP_CENTAVOS = 300_000;

function etiquetaFila(indice: number): string {
  let valor = indice;
  let etiqueta = '';
  while (valor > 0) {
    valor--;
    etiqueta = String.fromCharCode(65 + (valor % 26)) + etiqueta;
    valor = Math.floor(valor / 26);
  }
  return etiqueta;
}

function tipoFila(etiqueta: string): TipoButaca {
  if (etiqueta === 'J' || etiqueta === 'K') return 'accesible';
  if (['R', 'S', 'T'].includes(etiqueta)) return 'vip';
  return 'estandar';
}

function distribucionFila(sala: Sala, tipo: TipoButaca): [number, number, number] {
  return tipo === 'accesible'
    ? [2, 10, 2]
    : [sala.butacas_izquierda, sala.butacas_centro, sala.butacas_derecha];
}

export function generarMapaButacas(sala: Sala): FilaButacas[] {
  return Array.from({ length: sala.filas }, (_, indiceFila) => {
    const etiqueta = etiquetaFila(indiceFila + 1);
    const tipo = tipoFila(etiqueta);
    const cantidades = distribucionFila(sala, tipo);
    let numero = 1;
    const nombresSectores: SectorButaca[] = ['izquierda', 'centro', 'derecha'];
    const sectores = cantidades.map((cantidad, indiceSector) => Array.from({ length: cantidad }, () => {
      const butaca: ButacaMapa = {
        codigo: `${etiqueta}-${String(numero).padStart(2, '0')}`,
        fila: etiqueta,
        numero,
        sector: nombresSectores[indiceSector],
        tipo,
        precio_centavos: PRECIO_BUTACA_CENTAVOS + (tipo === 'vip' ? RECARGO_VIP_CENTAVOS : 0)
      };
      numero++;
      return butaca;
    })) as [ButacaMapa[], ButacaMapa[], ButacaMapa[]];

    return { etiqueta, tipo, sectores };
  });
}

export function buscarButaca(mapa: FilaButacas[], codigo: string): ButacaMapa | undefined {
  return mapa.flatMap(fila => fila.sectores.flat()).find(butaca => butaca.codigo === codigo);
}
