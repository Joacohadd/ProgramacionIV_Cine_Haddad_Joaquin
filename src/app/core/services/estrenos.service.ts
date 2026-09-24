import { computed, inject, Injectable, signal } from '@angular/core';
import { Compra } from '../models/compra.interface';
import { AlertaPelicula, PeliculaVista } from '../models/estreno.interface';
import { Resena } from '../models/resena.interface';
import { ventaHabilitada } from '../utils/estrenos';
import { AuthService } from './auth.service';
import { PeliculaService } from './pelicula.service';
import { ProgramacionService } from './programacion.service';
import { SupabaseService } from './supabase.service';

const DEMO_ALERTAS_KEY = 'umbral-demo-alertas-peliculas';
const DEMO_COMPRAS_KEY = 'umbral-demo-compras';
const DEMO_RESENAS_KEY = 'umbral-demo-resenas';

interface AlertaDemo {
  pelicula_id: string;
  creada_en: string;
  notificada_en: string | null;
  vista_en?: string | null;
}

@Injectable({ providedIn: 'root' })
export class EstrenosService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly peliculas = inject(PeliculaService);
  private readonly programacion = inject(ProgramacionService);
  private readonly alertasSignal = signal<AlertaPelicula[]>([]);
  private readonly vistasSignal = signal<PeliculaVista[]>([]);

  readonly alertas = computed(() => this.alertasSignal());
  readonly notificaciones = computed(() => this.alertasSignal().filter(alerta => alerta.notificacion_pendiente));
  readonly misPeliculas = computed(() => this.vistasSignal());
  readonly cargandoAlertas = signal(false);
  readonly cargandoHistorial = signal(false);
  readonly procesando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  tieneAlerta(peliculaId: string): boolean {
    return this.alertasSignal().some(alerta => alerta.pelicula_id === peliculaId);
  }

  async cargarAlertas(): Promise<void> {
    const perfil = this.auth.currentUserData();
    if (!perfil) {
      this.alertasSignal.set([]);
      return;
    }
    this.cargandoAlertas.set(true);
    this.error.set(null);
    const client = this.supabase.client;
    if (!client) {
      this.cargarAlertasDemo(perfil.id);
      this.cargandoAlertas.set(false);
      return;
    }

    const { data, error } = await client.rpc('mis_alertas_peliculas');
    if (error) {
      console.error('No se pudieron cargar las alertas de estrenos:', error.message);
      this.error.set('No se pudieron cargar las alertas. Revisá la migración del punto 4.10.');
    } else {
      this.alertasSignal.set((data ?? []) as AlertaPelicula[]);
    }
    this.cargandoAlertas.set(false);
  }

  async activarAlerta(peliculaId: string): Promise<void> {
    const perfil = this.auth.currentUserData();
    if (!perfil) throw new Error('Iniciá sesión para activar una alerta de estreno.');
    this.procesando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      const client = this.supabase.client;
      if (!client) {
        const todas = this.leerAlertasDemo();
        const propias = todas[perfil.id] ?? [];
        if (!propias.some(alerta => alerta.pelicula_id === peliculaId)) {
          todas[perfil.id] = [...propias, {
            pelicula_id: peliculaId,
            creada_en: new Date().toISOString(),
            notificada_en: null,
            vista_en: null
          }];
          localStorage.setItem(DEMO_ALERTAS_KEY, JSON.stringify(todas));
        }
      } else {
        const usuarioId = this.auth.currentUser()?.id;
        if (!usuarioId) throw new Error('La sesión venció. Ingresá nuevamente.');
        const { error } = await client.from('alertas_peliculas').insert({
          usuario_id: usuarioId,
          pelicula_id: peliculaId
        });
        if (error && error.code !== '23505') throw new Error(error.message);
      }
      await this.cargarAlertas();
      this.mensaje.set('Te avisaremos cuando se habilite la venta.');
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo activar la alerta.';
      this.error.set(mensaje);
      throw new Error(mensaje);
    } finally {
      this.procesando.set(false);
    }
  }

  async desactivarAlerta(peliculaId: string): Promise<void> {
    const perfil = this.auth.currentUserData();
    if (!perfil) return;
    this.procesando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      const client = this.supabase.client;
      if (!client) {
        const todas = this.leerAlertasDemo();
        todas[perfil.id] = (todas[perfil.id] ?? []).filter(alerta => alerta.pelicula_id !== peliculaId);
        localStorage.setItem(DEMO_ALERTAS_KEY, JSON.stringify(todas));
      } else {
        const { error } = await client.from('alertas_peliculas').delete()
          .eq('usuario_id', perfil.id).eq('pelicula_id', peliculaId);
        if (error) throw new Error(error.message);
      }
      await this.cargarAlertas();
      this.mensaje.set('Alerta desactivada.');
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo desactivar la alerta.';
      this.error.set(mensaje);
      throw new Error(mensaje);
    } finally {
      this.procesando.set(false);
    }
  }

  descartarNotificacion(peliculaId: string): void {
    this.alertasSignal.update(alertas => alertas.map(alerta => alerta.pelicula_id === peliculaId
      ? { ...alerta, notificacion_pendiente: false }
      : alerta));
    const perfil = this.auth.currentUserData();
    if (!perfil) return;
    const client = this.supabase.client;
    if (!client) {
      const todas = this.leerAlertasDemo();
      todas[perfil.id] = (todas[perfil.id] ?? []).map(alerta => alerta.pelicula_id === peliculaId
        ? { ...alerta, vista_en: new Date().toISOString() }
        : alerta);
      localStorage.setItem(DEMO_ALERTAS_KEY, JSON.stringify(todas));
      return;
    }
    void client.from('alertas_peliculas').update({ vista_en: new Date().toISOString() })
      .eq('usuario_id', perfil.id).eq('pelicula_id', peliculaId);
  }

  async cargarMisPeliculas(): Promise<void> {
    const perfil = this.auth.currentUserData();
    if (!perfil) {
      this.vistasSignal.set([]);
      return;
    }
    this.cargandoHistorial.set(true);
    const client = this.supabase.client;
    if (!client) {
      this.vistasSignal.set(this.armarHistorialDemo(perfil.id));
      this.cargandoHistorial.set(false);
      return;
    }

    const { data, error } = await client.from('mis_peliculas').select('*')
      .order('fecha_funcion', { ascending: false });
    if (error) {
      console.error('No se pudo cargar Mis películas:', error.message);
      this.error.set('No se pudo cargar el historial de películas vistas.');
    } else {
      this.vistasSignal.set((data ?? []).map(item => ({
        ...item,
        calificacion_propia: item['calificacion_propia'] == null ? null : Number(item['calificacion_propia'])
      })) as PeliculaVista[]);
    }
    this.cargandoHistorial.set(false);
  }

  private cargarAlertasDemo(usuarioId: string): void {
    const todas = this.leerAlertasDemo();
    const propias = todas[usuarioId] ?? [];
    const hoy = this.fechaISO(new Date());
    let cambio = false;
    const alertas = propias.flatMap(alerta => {
      const pelicula = this.peliculas.peliculas().find(item => item.id === alerta.pelicula_id);
      if (!pelicula) return [];
      const tieneFuncion = this.programacion.funcionesPorPelicula(pelicula.id).length > 0;
      const disponible = tieneFuncion && ventaHabilitada(pelicula, hoy);
      if (disponible && alerta.notificada_en == null) {
        alerta.notificada_en = new Date().toISOString();
        alerta.vista_en = null;
        cambio = true;
      }
      const pendiente = disponible && alerta.notificada_en != null && alerta.vista_en == null;
      return [{
        pelicula_id: pelicula.id,
        pelicula_titulo: pelicula.titulo,
        pelicula_imagen_url: pelicula.imagen_url,
        fecha_estreno: pelicula.fecha_estreno,
        creada_en: alerta.creada_en,
        notificada_en: alerta.notificada_en,
        venta_disponible: disponible,
        notificacion_pendiente: pendiente
      }];
    });
    if (cambio) {
      todas[usuarioId] = propias;
      localStorage.setItem(DEMO_ALERTAS_KEY, JSON.stringify(todas));
    }
    this.alertasSignal.set(alertas);
  }

  private armarHistorialDemo(usuarioId: string): PeliculaVista[] {
    if (typeof localStorage === 'undefined') return [];
    const compras = this.leerLocal<Compra[]>(DEMO_COMPRAS_KEY, []);
    const resenas = this.leerLocal<Resena[]>(DEMO_RESENAS_KEY, []);
    const ahora = Date.now();
    return compras
      .filter(compra => compra.usuario_id === usuarioId && compra.estado === 'pagada'
        && this.fechaHoraFuncion(compra.fecha_funcion, compra.hora_inicio) <= ahora)
      .map(compra => {
        const pelicula = this.peliculas.peliculas().find(item => item.id === compra.pelicula_id);
        const resena = resenas.find(item => item.pelicula_id === compra.pelicula_id && item.usuario_id === usuarioId);
        return {
          compra_id: compra.id,
          pelicula_id: compra.pelicula_id,
          pelicula_titulo: compra.pelicula_titulo,
          pelicula_imagen_url: pelicula?.imagen_url ?? '',
          fecha_funcion: compra.fecha_funcion,
          formato: compra.formato,
          idioma: compra.idioma,
          calificacion_propia: resena?.estrellas ?? null
        };
      })
      .sort((a, b) => b.fecha_funcion.localeCompare(a.fecha_funcion));
  }

  private leerAlertasDemo(): Record<string, AlertaDemo[]> {
    return this.leerLocal<Record<string, AlertaDemo[]>>(DEMO_ALERTAS_KEY, {});
  }

  private leerLocal<T>(clave: string, valorInicial: T): T {
    if (typeof localStorage === 'undefined') return valorInicial;
    const raw = localStorage.getItem(clave);
    if (!raw) return valorInicial;
    try { return JSON.parse(raw) as T; } catch { return valorInicial; }
  }

  private fechaHoraFuncion(fecha: string, hora: string): number {
    return new Date(`${fecha}T${hora.slice(0, 5)}:00-03:00`).getTime();
  }

  private fechaISO(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }
}
