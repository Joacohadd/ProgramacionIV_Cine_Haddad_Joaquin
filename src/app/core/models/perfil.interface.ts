export type Rol = 'cliente' | 'admin' | 'empleado';

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  fecha_nacimiento: string;
  tipo_sangre: string;
  color_ojos: string;
  dias_vacaciones: number;
  rol: Rol;
  puntos: number;
  credito_centavos: number;
}

export type DatosRegistro = Pick<Perfil, 'email' | 'nombre' | 'apellido' | 'fecha_nacimiento' | 'tipo_sangre' | 'color_ojos' | 'dias_vacaciones'> & { password: string };
