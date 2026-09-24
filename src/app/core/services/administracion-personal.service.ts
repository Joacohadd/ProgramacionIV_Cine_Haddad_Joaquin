import { computed, inject, Injectable, signal } from '@angular/core';
import { ActividadCine, CuentaPersonal } from '../models/auditoria.interface';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

const DEMO_PERFIL_KEY = 'umbral-demo-perfil';
const DEMO_AUDITORIA_KEY = 'umbral-demo-auditoria';

@Injectable({ providedIn: 'root' })
export class AdministracionPersonalService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly cuentasSignal = signal<CuentaPersonal[]>([]);
  private readonly actividadSignal = signal<ActividadCine[]>([]);

  readonly cuentas = computed(() => this.cuentasSignal());
  readonly actividad = computed(() => this.actividadSignal());
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  async cargar(): Promise<void> {
    this.exigirAdmin();
    this.cargando.set(true);
    this.error.set(null);
    try {
      const client = this.supabase.client;
      if (!client) {
        this.cargarDemo();
        return;
      }
      const [cuentas, actividad] = await Promise.all([
        client.from('perfiles').select('id,email,nombre,apellido,rol').order('email'),
        client.from('auditoria_actividad')
          .select('id,usuario_id,usuario_email,accion,entidad,entidad_id,detalle,creado_en')
          .order('creado_en', { ascending: false }).limit(150)
      ]);
      if (cuentas.error) throw new Error(cuentas.error.message);
      if (actividad.error) throw new Error(actividad.error.message);
      this.cuentasSignal.set((cuentas.data ?? []) as CuentaPersonal[]);
      this.actividadSignal.set((actividad.data ?? []) as ActividadCine[]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo cargar la actividad.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cambiarRol(cuenta: CuentaPersonal): Promise<void> {
    this.exigirAdmin();
    if (cuenta.rol === 'admin') return;
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    const nuevoRol = cuenta.rol === 'empleado' ? 'cliente' : 'empleado';
    try {
      const client = this.supabase.client;
      if (client) {
        const { error } = await client.rpc('asignar_rol_empleado', {
          p_usuario_id: cuenta.id, p_es_empleado: nuevoRol === 'empleado'
        });
        if (error) throw new Error(error.message);
      } else {
        const raw = localStorage.getItem(DEMO_PERFIL_KEY);
        if (!raw) throw new Error('Primero registrá una cuenta de muestra.');
        const perfil = JSON.parse(raw) as CuentaPersonal;
        if (perfil.id !== cuenta.id) throw new Error('La cuenta de muestra ya no existe.');
        localStorage.setItem(DEMO_PERFIL_KEY, JSON.stringify({ ...perfil, rol: nuevoRol }));
        this.registrarDemo(cuenta, nuevoRol);
      }
      await this.cargar();
      this.mensaje.set(nuevoRol === 'empleado'
        ? 'La cuenta ya puede usar la pantalla del personal.'
        : 'Se retiró el acceso de empleado.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo cambiar el rol.');
    } finally {
      this.guardando.set(false);
    }
  }

  private cargarDemo(): void {
    const admin = this.auth.currentUserData();
    const cuentas: CuentaPersonal[] = admin ? [admin] : [];
    const raw = localStorage.getItem(DEMO_PERFIL_KEY);
    if (raw) {
      try {
        const perfil = JSON.parse(raw) as CuentaPersonal;
        if (perfil.id && perfil.email && perfil.id !== admin?.id) cuentas.push(perfil);
      } catch { /* Solo se muestra la cuenta disponible. */ }
    }
    this.cuentasSignal.set(cuentas);
    const registros = localStorage.getItem(DEMO_AUDITORIA_KEY);
    try {
      this.actividadSignal.set(registros ? JSON.parse(registros) as ActividadCine[] : []);
    } catch {
      this.actividadSignal.set([]);
    }
  }

  private registrarDemo(cuenta: CuentaPersonal, rolNuevo: string): void {
    const raw = localStorage.getItem(DEMO_AUDITORIA_KEY);
    let registros: ActividadCine[] = [];
    try { registros = raw ? JSON.parse(raw) as ActividadCine[] : []; } catch { /* Registro nuevo. */ }
    const admin = this.auth.currentUserData();
    registros.unshift({
      id: crypto.randomUUID(), usuario_id: admin?.id ?? null,
      usuario_email: admin?.email ?? 'sistema', accion: 'rol_modificado',
      entidad: 'perfiles', entidad_id: cuenta.id,
      detalle: { email: cuenta.email, rol_anterior: cuenta.rol, rol_nuevo: rolNuevo },
      creado_en: new Date().toISOString()
    });
    localStorage.setItem(DEMO_AUDITORIA_KEY, JSON.stringify(registros));
  }

  private exigirAdmin(): void {
    if (this.auth.currentUserData()?.rol !== 'admin') {
      throw new Error('Solo un administrador puede gestionar el personal y la actividad.');
    }
  }
}
