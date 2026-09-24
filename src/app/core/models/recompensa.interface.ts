export type TipoRecompensa = 'entrada' | 'producto';

export interface Recompensa {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: TipoRecompensa;
  producto_id: string | null;
  costo_puntos: number;
  activo: boolean;
}

export type RecompensaEditable = Omit<Recompensa, 'id'>;

export interface CanjeRecompensa {
  id: string;
  codigo: string;
  recompensa_id: string;
  recompensa_nombre: string;
  recompensa_descripcion: string;
  tipo: TipoRecompensa;
  producto_id: string | null;
  producto_nombre: string | null;
  costo_puntos: number;
  creado_en: string;
}

export interface ResultadoCanjeRpc extends CanjeRecompensa {
  puntos_restantes: number;
}
