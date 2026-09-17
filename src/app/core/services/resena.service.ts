import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { RESENAS_DEMO } from '../data/resenas-demo';
import { NuevaResena, Resena } from '../models/resena.interface';
import { calcularPromedio } from '../utils/resenas';
import { AuthService } from './auth.service';
import { PeliculaService } from './pelicula.service';
import { SupabaseService } from './supabase.service';

const DEMO_REVIEWS_KEY = 'umbral-demo-resenas';

@Injectable({ providedIn: 'root' })
export class ResenaService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly peliculas = inject(PeliculaService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resenasSignal = signal<Resena[]>([]);
  private readonly peliculaActual = signal<string | null>(null);
  readonly resenas = computed(() => this.resenasSignal());
  readonly promedio = computed(() => calcularPromedio(this.resenasSignal()));
  readonly cantidad = computed(() => this.resenasSignal().length);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  private channel?: RealtimeChannel;
  private cargaNumero = 0;

  constructor() {
    if (this.supabase.client) {
      this.channel = this.supabase.client.channel('resenas-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'resenas' }, () => {
          const peliculaId = this.peliculaActual();
          if (peliculaId) void this.cargarPorPelicula(peliculaId);
        })
        .subscribe();
      this.destroyRef.onDestroy(() => {
        if (this.channel && this.supabase.client) void this.supabase.client.removeChannel(this.channel);
      });
    }
  }

  private leerDemo(): Resena[] {
    if (typeof localStorage === 'undefined') return RESENAS_DEMO;
    const raw = localStorage.getItem(DEMO_REVIEWS_KEY);
    if (!raw) return RESENAS_DEMO;
    try { return JSON.parse(raw) as Resena[]; } catch { return RESENAS_DEMO; }
  }

  private guardarDemo(resenas: Resena[]): void {
    this.resenasSignal.set(resenas);
    localStorage.setItem(DEMO_REVIEWS_KEY, JSON.stringify(resenas));
  }

  private actualizarResumen(peliculaId: string): void {
    this.peliculas.actualizarResumenResena(peliculaId, this.promedio(), this.cantidad());
  }

  async cargarPorPelicula(peliculaId: string): Promise<void> {
    const cargaActual = ++this.cargaNumero;
    this.peliculaActual.set(peliculaId);
    this.error.set(null);
    this.mensaje.set(null);
    this.cargando.set(true);
    const client = this.supabase.client;
    if (!client) {
      const reviews = this.leerDemo().filter(resena => resena.pelicula_id === peliculaId);
      this.resenasSignal.set(reviews);
      this.actualizarResumen(peliculaId);
      this.cargando.set(false);
      return;
    }
    const { data, error } = await client
      .from('resenas')
      .select('id,pelicula_id,usuario_id,autor_nombre,estrellas,comentario,creado_en')
      .eq('pelicula_id', peliculaId)
      .order('creado_en', { ascending: false });
    if (cargaActual !== this.cargaNumero) return;
    if (error) {
      console.error('No se pudieron cargar las reseñas:', error.code, error.message);
      this.error.set('Las reseñas no están disponibles por ahora.');
    } else {
      this.resenasSignal.set((data ?? []) as Resena[]);
      this.actualizarResumen(peliculaId);
    }
    this.cargando.set(false);
  }

  async crear(peliculaId: string, estrellas: number, comentario: string): Promise<void> {
    const perfil = this.auth.currentUserData();
    if (!perfil) throw new Error('Iniciá sesión para publicar una reseña.');
    if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) throw new Error('Elegí una puntuación de 1 a 5 estrellas.');
    const texto = comentario.trim();
    if (texto.length < 5 || texto.length > 280) throw new Error('El comentario debe tener entre 5 y 280 caracteres.');
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    const nueva: NuevaResena = {
      pelicula_id: peliculaId,
      usuario_id: this.auth.currentUser()?.id ?? perfil.id,
      autor_nombre: `${perfil.nombre} ${perfil.apellido}`.trim(),
      estrellas,
      comentario: texto
    };
    try {
      const client = this.supabase.client;
      if (!client) {
        const todas = this.leerDemo();
        const propia = todas.findIndex(resena => resena.pelicula_id === peliculaId && resena.usuario_id === nueva.usuario_id);
        const resena: Resena = { ...nueva, id: propia >= 0 ? todas[propia].id : crypto.randomUUID(), creado_en: new Date().toISOString() };
        if (propia >= 0) todas[propia] = resena;
        else todas.unshift(resena);
        this.guardarDemo(todas.filter(item => item.pelicula_id === peliculaId).concat(todas.filter(item => item.pelicula_id !== peliculaId)));
        this.resenasSignal.set(this.leerDemo().filter(item => item.pelicula_id === peliculaId));
        this.actualizarResumen(peliculaId);
      } else {
        const { error } = await client.from('resenas').upsert(nueva, { onConflict: 'pelicula_id,usuario_id' });
        if (error) {
          if (error.code === '23505') throw new Error('Ya publicaste una reseña para esta película.');
          throw error;
        }
        await this.cargarPorPelicula(peliculaId);
      }
      this.mensaje.set('Tu reseña quedó publicada.');
    } finally {
      this.guardando.set(false);
    }
  }
}
