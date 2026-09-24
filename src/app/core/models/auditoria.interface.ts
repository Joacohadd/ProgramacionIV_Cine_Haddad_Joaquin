import { Rol } from './perfil.interface';

export interface CuentaPersonal {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: Rol;
}

export interface ActividadCine {
  id: number | string;
  usuario_id: string | null;
  usuario_email: string;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  detalle: Record<string, unknown>;
  creado_en: string;
}
