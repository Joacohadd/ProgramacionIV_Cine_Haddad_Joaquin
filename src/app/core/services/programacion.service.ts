import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { FUNCIONES_DEMO, SALAS_DEMO } from '../data/programacion-demo';
import { Funcion, FuncionDetalle, FuncionEditable, Sala, SalaEditable } from '../models/programacion.interface';
import { buscarSalaDisponible } from '../utils/planificacion';
import { PeliculaService } from './pelicula.service';
import { SupabaseService } from './supabase.service';

const DEMO_ROOMS_KEY = 'umbral-demo-salas';
const DEMO_SHOWS_KEY = 'umbral-demo-funciones';

@Injectable({ providedIn: 'root' })
export class ProgramacionService {
  private readonly supabase = inject(SupabaseService);
  private readonly peliculasServicio = inject(PeliculaService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly salasSignal = signal<Sala[]>([]);
  private readonly funcionesSignal = signal<FuncionDetalle[]>([]);
  readonly salas = computed(() => this.salasSignal());
  readonly funciones = computed(() => this.funcionesSignal());
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  private channel?: RealtimeChannel;

  constructor() {
    if (this.supabase.client) {
      void this.cargar();
      this.channel = this.supabase.client.channel('programacion-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'salas' }, () => void this.cargar())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'funciones' }, () => void this.cargar())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'peliculas' }, () => void this.cargar())
        .subscribe();
      this.destroyRef.onDestroy(() => {
        if (this.channel && this.supabase.client) void this.supabase.client.removeChannel(this.channel);
      });
    } else {
      const salas = this.leerSalasDemo();
      this.salasSignal.set(salas);
      this.funcionesSignal.set(this.enriquecer(this.leerFuncionesDemo(), salas));
    }
  }

  private leerSalasDemo(): Sala[] {
    if (typeof localStorage === 'undefined') return SALAS_DEMO;
    const raw = localStorage.getItem(DEMO_ROOMS_KEY);
    if (!raw) return SALAS_DEMO;
    try { return JSON.parse(raw) as Sala[]; } catch { return SALAS_DEMO; }
  }

  private leerFuncionesDemo(): Funcion[] {
    if (typeof localStorage === 'undefined') return FUNCIONES_DEMO;
    const raw = localStorage.getItem(DEMO_SHOWS_KEY);
    if (!raw) return FUNCIONES_DEMO;
    try { return JSON.parse(raw) as Funcion[]; } catch { return FUNCIONES_DEMO; }
  }

  private enriquecer(funciones: Funcion[], salas: Sala[]): FuncionDetalle[] {
    const peliculas = this.peliculasServicio.peliculas();
    return funciones.flatMap(funcion => {
      const pelicula = peliculas.find(item => item.id === funcion.pelicula_id);
      const sala = salas.find(item => item.id === funcion.sala_id);
      if (!pelicula || !sala) return [];
      return [{
        ...funcion,
        hora_inicio: funcion.hora_inicio.slice(0, 5),
        pelicula_titulo: pelicula.titulo,
        pelicula_imagen_url: pelicula.imagen_url,
        duracion_minutos: pelicula.duracion_minutos,
        sala_nombre: sala.nombre
      }];
    });
  }

  async cargar(): Promise<void> {
    const client = this.supabase.client;
    if (!client) return;
    this.cargando.set(true);
    this.error.set(null);
    const [salasResultado, funcionesResultado] = await Promise.all([
      client.from('salas').select('id,nombre,filas,butacas_izquierda,butacas_centro,butacas_derecha,formatos,activa').order('nombre'),
      client.from('funciones_detalle').select('*').order('hora_inicio')
    ]);
    if (salasResultado.error || funcionesResultado.error) {
      const detalle = salasResultado.error?.message ?? funcionesResultado.error?.message;
      console.error('No se pudo cargar la programación:', detalle);
      this.error.set('La programación no está disponible. Revisá que la migración del punto 4.4 esté aplicada.');
    } else {
      this.salasSignal.set((salasResultado.data ?? []) as Sala[]);
      this.funcionesSignal.set(((funcionesResultado.data ?? []) as FuncionDetalle[]).map(funcion => ({
        ...funcion,
        hora_inicio: funcion.hora_inicio.slice(0, 5),
        dias_semana: funcion.dias_semana.map(Number) as FuncionDetalle['dias_semana']
      })));
    }
    this.cargando.set(false);
  }

  async guardarSala(sala: SalaEditable, id?: string): Promise<void> {
    this.error.set(null);
    this.mensaje.set(null);
    const normalizada: SalaEditable = { ...sala, nombre: sala.nombre.trim(), formatos: [...new Set(sala.formatos)] };
    const client = this.supabase.client;
    if (!client) {
      const salas = [...this.salasSignal()];
      const nombreRepetido = salas.some(item => item.id !== id && item.nombre.toLocaleLowerCase() === normalizada.nombre.toLocaleLowerCase());
      if (nombreRepetido) throw new Error('Ya existe una sala con ese nombre.');
      const funcionIncompatible = id && this.funcionesSignal().find(funcion =>
        funcion.sala_id === id && funcion.activa && (!normalizada.activa || !normalizada.formatos.includes(funcion.formato))
      );
      if (funcionIncompatible) throw new Error('La sala tiene funciones activas que necesitan uno de los formatos eliminados.');
      if (id) {
        const index = salas.findIndex(item => item.id === id);
        if (index < 0) throw new Error('La sala no existe.');
        salas[index] = { ...normalizada, id };
      } else salas.push({ ...normalizada, id: crypto.randomUUID() });
      this.salasSignal.set(salas.sort((a, b) => a.nombre.localeCompare(b.nombre)));
      localStorage.setItem(DEMO_ROOMS_KEY, JSON.stringify(salas));
      this.funcionesSignal.set(this.enriquecer(this.leerFuncionesDemo(), salas));
    } else {
      const consulta = id ? client.from('salas').update(normalizada).eq('id', id) : client.from('salas').insert(normalizada);
      const { error } = await consulta;
      if (error) throw new Error(error.message);
      await this.cargar();
    }
    this.mensaje.set(id ? 'Sala actualizada.' : 'Sala creada.');
  }

  async guardarFuncion(funcion: FuncionEditable, id?: string): Promise<string> {
    this.error.set(null);
    this.mensaje.set(null);
    const client = this.supabase.client;
    if (!client) {
      const funcionesBase = this.leerFuncionesDemo();
      const anterior = id ? funcionesBase.find(item => item.id === id) : undefined;
      const sala = buscarSalaDisponible(
        this.salasSignal(), this.funcionesSignal(), this.peliculasServicio.peliculas(), funcion, id, anterior?.sala_id
      );
      if (!sala) throw new Error('No hay una sala compatible y libre para esos días y horario.');
      const nueva: Funcion = { ...funcion, id: id ?? crypto.randomUUID(), sala_id: sala.id };
      const actualizadas = id ? funcionesBase.map(item => item.id === id ? nueva : item) : [...funcionesBase, nueva];
      localStorage.setItem(DEMO_SHOWS_KEY, JSON.stringify(actualizadas));
      this.funcionesSignal.set(this.enriquecer(actualizadas, this.salasSignal()));
      this.mensaje.set(`Programación guardada. ${sala.nombre} fue asignada automáticamente.`);
      return sala.nombre;
    }

    const consulta = id
      ? client.from('funciones').update(funcion).eq('id', id).select('id,sala_id').single()
      : client.from('funciones').insert(funcion).select('id,sala_id').single();
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    await this.cargar();
    const salaNombre = this.salasSignal().find(item => item.id === data.sala_id)?.nombre ?? 'Sala asignada';
    this.mensaje.set(`Programación guardada. ${salaNombre} fue asignada automáticamente.`);
    return salaNombre;
  }

  async eliminarFuncion(id: string): Promise<void> {
    this.error.set(null);
    this.mensaje.set(null);
    const client = this.supabase.client;
    if (!client) {
      const funciones = this.leerFuncionesDemo().filter(item => item.id !== id);
      localStorage.setItem(DEMO_SHOWS_KEY, JSON.stringify(funciones));
      this.funcionesSignal.set(this.enriquecer(funciones, this.salasSignal()));
    } else {
      const { error } = await client.from('funciones').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await this.cargar();
    }
    this.mensaje.set('Programación eliminada.');
  }

  funcionesPorPelicula(peliculaId: string): FuncionDetalle[] {
    return this.funcionesSignal().filter(funcion => funcion.pelicula_id === peliculaId && funcion.activa);
  }
}
