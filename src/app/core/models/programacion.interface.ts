export type FormatoProyeccion = '2D' | '3D' | '4D' | '5D';
export type IdiomaFuncion = 'Castellano' | 'Subtitulada';
export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DIAS_SEMANA: ReadonlyArray<{ valor: DiaSemana; nombre: string; corto: string }> = [
  { valor: 1, nombre: 'Lunes', corto: 'Lun' },
  { valor: 2, nombre: 'Martes', corto: 'Mar' },
  { valor: 3, nombre: 'Miércoles', corto: 'Mié' },
  { valor: 4, nombre: 'Jueves', corto: 'Jue' },
  { valor: 5, nombre: 'Viernes', corto: 'Vie' },
  { valor: 6, nombre: 'Sábado', corto: 'Sáb' },
  { valor: 7, nombre: 'Domingo', corto: 'Dom' }
];

export const FORMATOS_PROYECCION: FormatoProyeccion[] = ['2D', '3D', '4D', '5D'];

export interface Sala {
  id: string;
  nombre: string;
  filas: number;
  butacas_izquierda: number;
  butacas_centro: number;
  butacas_derecha: number;
  formatos: FormatoProyeccion[];
  activa: boolean;
}

export type SalaEditable = Omit<Sala, 'id'>;

export interface Funcion {
  id: string;
  pelicula_id: string;
  sala_id: string;
  fecha_desde: string;
  fecha_hasta: string;
  dias_semana: DiaSemana[];
  hora_inicio: string;
  formato: FormatoProyeccion;
  idioma: IdiomaFuncion;
  activa: boolean;
}

export type FuncionEditable = Omit<Funcion, 'id' | 'sala_id'>;

export interface FuncionDetalle extends Funcion {
  pelicula_titulo: string;
  pelicula_imagen_url: string;
  duracion_minutos: number;
  sala_nombre: string;
}
