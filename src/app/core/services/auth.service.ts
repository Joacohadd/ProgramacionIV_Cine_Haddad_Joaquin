import { Injectable, inject, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { DatosRegistro, Perfil } from '../models/perfil.interface';
import { SupabaseService } from './supabase.service';

const DEMO_PERFIL_KEY = 'umbral-demo-perfil';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);
  readonly currentUser = signal<User | null>(null);
  readonly currentSession = signal<Session | null>(null);
  readonly currentUserData = signal<Perfil | null>(null);
  readonly ready = signal(false);
  readonly demo = !this.supabase.configurado;

  constructor() {
    const client = this.supabase.client;
    if (!client) {
      this.ready.set(true);
      return;
    }
    void client.auth.getSession().then(async ({ data, error }) => {
      if (error) console.error('No se pudo recuperar la sesión:', error.message);
      await this.actualizarSesion(data.session);
      this.ready.set(true);
    });
    client.auth.onAuthStateChange((_event, session) => { void this.actualizarSesion(session); });
  }

  private async actualizarSesion(session: Session | null): Promise<void> {
    this.currentSession.set(session);
    this.currentUser.set(session?.user ?? null);
    this.currentUserData.set(null);
    if (session?.user) await this.cargarPerfil(session.user.id);
  }

  async perfilActual(): Promise<Perfil | null> {
    const client = this.supabase.client;
    if (!client) return this.currentUserData();
    const { data } = await client.auth.getSession();
    if (!data.session) return null;
    this.currentSession.set(data.session);
    this.currentUser.set(data.session.user);
    await this.cargarPerfil(data.session.user.id);
    return this.currentUserData();
  }

  async recargarPerfil(): Promise<void> {
    const usuario = this.currentUser();
    if (usuario) await this.cargarPerfil(usuario.id);
  }

  actualizarCreditoDemo(creditoCentavos: number): void {
    if (!this.demo) return;
    const perfil = this.currentUserData();
    if (!perfil) return;
    const actualizado = { ...perfil, credito_centavos: Math.max(0, Math.round(creditoCentavos)) };
    this.currentUserData.set(actualizado);
    if (perfil.id !== 'demo-admin') localStorage.setItem(DEMO_PERFIL_KEY, JSON.stringify(actualizado));
  }

  private async cargarPerfil(id: string): Promise<void> {
    const client = this.supabase.client;
    if (!client) return;
    const { data, error } = await client.from('perfiles').select('*').eq('id', id).single();
    if (error) console.error('No se pudo cargar el perfil:', error.message);
    if (data && this.currentUser()?.id === id) this.currentUserData.set(data as Perfil);
  }

  async signUp(datos: DatosRegistro): Promise<{ pendingConfirmation: boolean }> {
    const client = this.supabase.client;
    if (!client) {
      // Muestra local: nunca guardamos la contraseña. La cuenta no es real.
      const perfil: Perfil = {
        id: crypto.randomUUID(), email: datos.email, nombre: datos.nombre,
        apellido: datos.apellido, fecha_nacimiento: datos.fecha_nacimiento,
        tipo_sangre: datos.tipo_sangre, color_ojos: datos.color_ojos,
        dias_vacaciones: datos.dias_vacaciones, rol: 'cliente', puntos: 0,
        credito_centavos: 0
      };
      localStorage.setItem(DEMO_PERFIL_KEY, JSON.stringify(perfil));
      this.currentUserData.set(perfil);
      return { pendingConfirmation: false };
    }
    const { data, error } = await client.auth.signUp({
      email: datos.email,
      password: datos.password,
      options: { data: {
        nombre: datos.nombre, apellido: datos.apellido,
        fecha_nacimiento: datos.fecha_nacimiento, tipo_sangre: datos.tipo_sangre,
        color_ojos: datos.color_ojos, dias_vacaciones: datos.dias_vacaciones
      } }
    });
    if (error) throw error;
    if (data.user?.identities?.length === 0) throw new Error('Ese correo ya está registrado.');
    if (data.session?.user) await this.cargarPerfil(data.session.user.id);
    return { pendingConfirmation: !data.session };
  }

  async signIn(email: string, password: string): Promise<void> {
    const client = this.supabase.client;
    if (!client) throw new Error('El acceso con contraseña requiere configurar Supabase. Usá la cuenta de muestra.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.user) await this.cargarPerfil(data.user.id);
  }

  ingresarDemo(): boolean {
    if (!this.demo) return false;
    const raw = localStorage.getItem(DEMO_PERFIL_KEY);
    if (!raw) return false;
    try {
      const perfil = JSON.parse(raw) as Perfil;
      if (!perfil.id || !perfil.email) return false;
      this.currentUserData.set(perfil);
      return true;
    } catch { return false; }
  }

  ingresarAdminDemo(): void {
    if (!this.demo) return;
    this.currentUserData.set({
      id: 'demo-admin', email: 'admin@umbral.demo', nombre: 'Equipo', apellido: 'Umbral',
      fecha_nacimiento: '1980-01-01', tipo_sangre: 'O+', color_ojos: 'Marrón',
      dias_vacaciones: 0, rol: 'admin', puntos: 0, credito_centavos: 0
    });
  }

  async signOut(): Promise<void> {
    if (this.supabase.client) {
      const { error } = await this.supabase.client.auth.signOut();
      if (error) throw error;
    }
    this.currentUser.set(null);
    this.currentSession.set(null);
    this.currentUserData.set(null);
  }
}
