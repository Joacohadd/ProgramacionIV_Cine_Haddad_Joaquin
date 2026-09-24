import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { PELICULAS_DEMO } from '../data/peliculas-demo';
import { Pelicula, PeliculaEditable } from '../models/pelicula.interface';
import { SupabaseService } from './supabase.service';

const DEMO_MOVIES_KEY = 'umbral-demo-peliculas';

@Injectable({ providedIn: 'root' })
export class PeliculaService {
  private readonly supabase = inject(SupabaseService);
  private readonly destroyRef = inject(DestroyRef);
  // Si Supabase está configurado, jamás mezclamos la cartelera real con datos ficticios.
  private readonly peliculasSignal = signal<Pelicula[]>(this.supabase.client ? [] : this.leerDemo());
  readonly peliculas = computed(() => this.peliculasSignal());
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  private channel?: RealtimeChannel;

  constructor() {
    if (this.supabase.client) {
      void this.cargarPeliculas();
      this.channel = this.supabase.client.channel('peliculas-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'peliculas' }, () => void this.cargarPeliculas())
        .subscribe();
      this.destroyRef.onDestroy(() => { if (this.channel && this.supabase.client) void this.supabase.client.removeChannel(this.channel); });
    }
  }

  private leerDemo(): Pelicula[] {
    if (typeof localStorage === 'undefined') return PELICULAS_DEMO;
    const raw = localStorage.getItem(DEMO_MOVIES_KEY);
    if (!raw) return PELICULAS_DEMO;
    try { return (JSON.parse(raw) as Pelicula[]).map(pelicula => this.normalizar(pelicula)); } catch { return PELICULAS_DEMO; }
  }

  private normalizar(pelicula: Partial<Pelicula>): Pelicula {
    return {
      ...pelicula,
      promedio_calificacion: Number(pelicula.promedio_calificacion ?? 0),
      cantidad_resenas: Number(pelicula.cantidad_resenas ?? 0),
      preventa_habilitada: Boolean(pelicula.preventa_habilitada),
      precio_preventa_centavos: pelicula.precio_preventa_centavos == null ? null : Number(pelicula.precio_preventa_centavos)
    } as Pelicula;
  }

  private guardarDemo(peliculas: Pelicula[]): void {
    this.peliculasSignal.set(peliculas);
    localStorage.setItem(DEMO_MOVIES_KEY, JSON.stringify(peliculas));
  }

  async cargarPeliculas(): Promise<void> {
    const client = this.supabase.client;
    if (!client) return;
    this.cargando.set(true);
    this.error.set(null);
    const { data, error } = await client.from('peliculas_con_ventas').select('*').order('titulo');
    if (error) {
      console.error('No se pudo consultar peliculas_con_ventas:', error.code, error.message);
      this.error.set('La cartelera no está disponible en este momento. Intentá más tarde.');
    }
    else this.peliculasSignal.set((data ?? []).map(item => this.normalizar(item as Partial<Pelicula>)));
    this.cargando.set(false);
  }

  getPeliculaById(id: string) {
    return computed(() => this.peliculas().find(pelicula => pelicula.id === id));
  }

  async guardar(pelicula: PeliculaEditable, id?: string): Promise<void> {
    const client = this.supabase.client;
    if (!client) {
      const lista = [...this.peliculas()];
      if (id) {
        const index = lista.findIndex(item => item.id === id);
        if (index < 0) throw new Error('La película no existe.');
        lista[index] = { ...lista[index], ...pelicula };
      } else {
        lista.push({ ...pelicula, id: crypto.randomUUID(), entradas_vendidas: 0, promedio_calificacion: 0, cantidad_resenas: 0 });
      }
      this.guardarDemo(lista);
      return;
    }
    const query = id
      ? client.from('peliculas').update(pelicula).eq('id', id)
      : client.from('peliculas').insert(pelicula);
    const { error } = await query;
    if (error) throw error;
    await this.cargarPeliculas();
  }

  actualizarResumenResena(peliculaId: string, promedio: number, cantidad: number): void {
    this.peliculasSignal.update(peliculas => peliculas.map(pelicula => pelicula.id === peliculaId
      ? { ...pelicula, promedio_calificacion: promedio, cantidad_resenas: cantidad }
      : pelicula));
  }

  actualizarEntradasVendidasDemo(peliculaId: string, diferencia: number): void {
    if (this.supabase.client) return;
    const peliculas = this.peliculas().map(pelicula => pelicula.id === peliculaId
      ? { ...pelicula, entradas_vendidas: Math.max(0, pelicula.entradas_vendidas + diferencia) }
      : pelicula);
    this.guardarDemo(peliculas);
  }
}
