import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  ButacaMapa, EstadoVisualButaca, ReservaButaca, TipoButaca
} from '../models/butaca.interface';
import { PRECIO_BUTACA_CENTAVOS, RECARGO_VIP_CENTAVOS } from '../utils/butacas';
import { SupabaseService } from './supabase.service';

const SESSION_KEY = 'umbral-sesion-butacas';
const DEMO_KEY = 'umbral-demo-reservas-butacas';
const RESERVA_MINUTOS = 8;
const BUTACAS_OCUPADAS_DEMO = ['A-03', 'F-17', 'J-05', 'R-22'];

@Injectable({ providedIn: 'root' })
export class ButacasService {
  private readonly supabase = inject(SupabaseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reservasSignal = signal<ReservaButaca[]>([]);
  private readonly seleccionadasSignal = signal<string[]>([]);
  private funcionId = '';
  private fechaFuncion = '';
  private sesionToken = '';
  private sesionHash = '';
  private precioBaseCentavos = PRECIO_BUTACA_CENTAVOS;
  private channel?: RealtimeChannel;
  private broadcast?: BroadcastChannel;

  readonly reservas = computed(() => this.reservasSignal());
  readonly seleccionadas = computed(() => this.seleccionadasSignal());
  readonly cantidad = computed(() => this.seleccionadasSignal().length);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly expiraEn = signal<string | null>(null);

  constructor() {
    if (!this.supabase.client && typeof window !== 'undefined') {
      window.addEventListener('storage', this.recibirCambioDemo);
      if ('BroadcastChannel' in window) {
        this.broadcast = new BroadcastChannel('umbral-butacas');
        this.broadcast.onmessage = () => this.cargarDemo();
      }
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('storage', this.recibirCambioDemo);
        this.broadcast?.close();
      });
    }
  }

  async conectar(funcionId: string, fechaFuncion: string, precioBaseCentavos = PRECIO_BUTACA_CENTAVOS): Promise<void> {
    if (this.funcionId === funcionId && this.fechaFuncion === fechaFuncion && this.precioBaseCentavos === precioBaseCentavos) return;
    if (this.funcionId && this.seleccionadasSignal().length) await this.sincronizar([]);

    this.desconectarCanal();
    this.funcionId = funcionId;
    this.fechaFuncion = fechaFuncion;
    this.precioBaseCentavos = precioBaseCentavos;
    this.sesionToken = this.obtenerSesionToken();
    this.sesionHash = await this.calcularHash(this.sesionToken);
    this.seleccionadasSignal.set([]);
    this.expiraEn.set(null);
    this.error.set(null);
    this.mensaje.set(null);
    await this.cargar();

    const client = this.supabase.client;
    if (client) {
      this.channel = client.channel(`butacas-${funcionId}-${fechaFuncion}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'reservas_butacas', filter: `funcion_id=eq.${funcionId}`
        }, () => void this.cargar())
        .subscribe();
    }
  }

  desconectar(): void {
    this.desconectarCanal();
    this.funcionId = '';
    this.fechaFuncion = '';
    this.reservasSignal.set([]);
    this.seleccionadasSignal.set([]);
  }

  estado(codigo: string): EstadoVisualButaca {
    if (this.seleccionadasSignal().includes(codigo)) return 'seleccionada';
    const reserva = this.reservasSignal().find(item => item.butaca_codigo === codigo);
    return reserva?.estado ?? 'libre';
  }

  async alternar(butaca: ButacaMapa): Promise<void> {
    if (this.guardando()) return;
    const estado = this.estado(butaca.codigo);
    if (estado === 'ocupada' || estado === 'reservada') return;

    const anterior = this.seleccionadasSignal();
    const siguiente = anterior.includes(butaca.codigo)
      ? anterior.filter(codigo => codigo !== butaca.codigo)
      : [...anterior, butaca.codigo];
    this.seleccionadasSignal.set(siguiente);
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      await this.sincronizar(siguiente);
    } catch (error) {
      this.seleccionadasSignal.set(anterior);
      this.error.set(error instanceof Error ? error.message : 'No se pudo reservar la butaca.');
      await this.cargar();
    } finally {
      this.guardando.set(false);
    }
  }

  async limpiar(): Promise<void> {
    if (!this.seleccionadasSignal().length || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    try {
      await this.sincronizar([]);
      this.mensaje.set('Selección liberada.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo liberar la selección.');
    } finally {
      this.guardando.set(false);
    }
  }

  tokenReserva(): string {
    return this.sesionToken || this.obtenerSesionToken();
  }

  async marcarCompraConfirmada(): Promise<void> {
    const client = this.supabase.client;
    if (!client) {
      const seleccionadas = new Set(this.seleccionadasSignal());
      const actualizadas = this.leerReservasDemo().map(reserva =>
        reserva.funcion_id === this.funcionId &&
        reserva.fecha_funcion === this.fechaFuncion &&
        reserva.sesion_hash === this.sesionHash &&
        seleccionadas.has(reserva.butaca_codigo)
          ? { ...reserva, estado: 'ocupada' as const, expira_en: null }
          : reserva
      );
      localStorage.setItem(DEMO_KEY, JSON.stringify(actualizadas));
      this.broadcast?.postMessage('actualizar');
    }
    this.seleccionadasSignal.set([]);
    this.expiraEn.set(null);
    await this.cargar();
  }

  liberarCompraDemo(funcionId: string, fechaFuncion: string, codigos: string[]): void {
    if (this.supabase.client) return;
    const quitar = new Set(codigos);
    const actualizadas = this.leerReservasDemo().filter(reserva => !(
      reserva.funcion_id === funcionId &&
      reserva.fecha_funcion === fechaFuncion &&
      reserva.estado === 'ocupada' &&
      quitar.has(reserva.butaca_codigo)
    ));
    localStorage.setItem(DEMO_KEY, JSON.stringify(actualizadas));
    this.broadcast?.postMessage('actualizar');
    this.cargarDemo();
  }

  private async cargar(): Promise<void> {
    if (!this.funcionId || !this.fechaFuncion) return;
    const client = this.supabase.client;
    if (!client) {
      this.cargarDemo();
      return;
    }

    this.cargando.set(true);
    const { data, error } = await client.from('reservas_butacas')
      .select('id,funcion_id,fecha_funcion,butaca_codigo,tipo,estado,sesion_hash,precio_centavos,expira_en')
      .eq('funcion_id', this.funcionId)
      .eq('fecha_funcion', this.fechaFuncion);
    if (error) {
      console.error('No se pudieron cargar las butacas:', error.message);
      this.error.set('Las butacas no están disponibles. Aplicá la migración del punto 4.5 en Supabase.');
    } else {
      this.aplicarReservas((data ?? []) as ReservaButaca[]);
    }
    this.cargando.set(false);
  }

  private async sincronizar(codigos: string[]): Promise<void> {
    const client = this.supabase.client;
    if (!client) {
      this.sincronizarDemo(codigos);
      return;
    }

    const { error } = await client.rpc('sincronizar_reserva_butacas', {
      p_funcion_id: this.funcionId,
      p_fecha: this.fechaFuncion,
      p_codigos: codigos,
      p_sesion_token: this.sesionToken
    });
    if (error) {
      if (error.message.toLocaleLowerCase().includes('reservada')) {
        throw new Error('Una de las butacas acaba de ser reservada por otra persona. Elegí otra ubicación.');
      }
      throw new Error(error.message);
    }
    await this.cargar();
  }

  private aplicarReservas(reservas: ReservaButaca[]): void {
    const ahora = Date.now();
    const activas = reservas.filter(reserva =>
      reserva.estado === 'ocupada' || Boolean(reserva.expira_en && new Date(reserva.expira_en).getTime() > ahora)
    );
    this.reservasSignal.set(activas);
    const propias = activas.filter(reserva => reserva.estado === 'reservada' && reserva.sesion_hash === this.sesionHash);
    this.seleccionadasSignal.set(propias.map(reserva => reserva.butaca_codigo));
    this.expiraEn.set(propias[0]?.expira_en ?? null);
  }

  private cargarDemo(): void {
    if (!this.funcionId || !this.fechaFuncion) return;
    const ahora = Date.now();
    const guardadas = this.leerReservasDemo().filter(reserva =>
      reserva.estado === 'ocupada' || Boolean(reserva.expira_en && new Date(reserva.expira_en).getTime() > ahora)
    );
    const ocupadas = BUTACAS_OCUPADAS_DEMO.map(codigo => this.reservaDemoOcupada(codigo));
    this.aplicarReservas([
      ...ocupadas,
      ...guardadas.filter(reserva => reserva.funcion_id === this.funcionId && reserva.fecha_funcion === this.fechaFuncion)
    ]);
  }

  private sincronizarDemo(codigos: string[]): void {
    const ahora = Date.now();
    const todas = this.leerReservasDemo().filter(reserva =>
      reserva.estado === 'ocupada' || Boolean(reserva.expira_en && new Date(reserva.expira_en).getTime() > ahora)
    );
    const ajenas = todas.filter(reserva => !(
      reserva.funcion_id === this.funcionId &&
      reserva.fecha_funcion === this.fechaFuncion &&
      reserva.sesion_hash === this.sesionHash &&
      reserva.estado === 'reservada'
    ));
    const ocupadas = new Set([
      ...BUTACAS_OCUPADAS_DEMO,
      ...ajenas.filter(reserva => reserva.funcion_id === this.funcionId && reserva.fecha_funcion === this.fechaFuncion)
        .map(reserva => reserva.butaca_codigo)
    ]);
    if (codigos.some(codigo => ocupadas.has(codigo))) {
      throw new Error('Una de las butacas acaba de ser reservada por otra persona. Elegí otra ubicación.');
    }

    const expiraEn = new Date(ahora + RESERVA_MINUTOS * 60_000).toISOString();
    const nuevas = codigos.map(codigo => this.reservaDemo(codigo, expiraEn));
    localStorage.setItem(DEMO_KEY, JSON.stringify([...ajenas, ...nuevas]));
    this.broadcast?.postMessage('actualizar');
    this.cargarDemo();
  }

  private leerReservasDemo(): ReservaButaca[] {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as ReservaButaca[]; } catch { return []; }
  }

  private reservaDemo(codigo: string, expiraEn: string): ReservaButaca {
    const tipo = this.tipoDesdeCodigo(codigo);
    return {
      id: `${this.sesionHash}-${this.funcionId}-${this.fechaFuncion}-${codigo}`,
      funcion_id: this.funcionId,
      fecha_funcion: this.fechaFuncion,
      butaca_codigo: codigo,
      tipo,
      estado: 'reservada',
      sesion_hash: this.sesionHash,
      precio_centavos: this.precioBaseCentavos + (tipo === 'vip' ? RECARGO_VIP_CENTAVOS : 0),
      expira_en: expiraEn
    };
  }

  private reservaDemoOcupada(codigo: string): ReservaButaca {
    const tipo = this.tipoDesdeCodigo(codigo);
    return {
      id: `ocupada-${this.funcionId}-${this.fechaFuncion}-${codigo}`,
      funcion_id: this.funcionId,
      fecha_funcion: this.fechaFuncion,
      butaca_codigo: codigo,
      tipo,
      estado: 'ocupada',
      sesion_hash: 'sistema-demo',
      precio_centavos: this.precioBaseCentavos + (tipo === 'vip' ? RECARGO_VIP_CENTAVOS : 0),
      expira_en: null
    };
  }

  private tipoDesdeCodigo(codigo: string): TipoButaca {
    const fila = codigo.split('-')[0];
    if (fila === 'J' || fila === 'K') return 'accesible';
    if (['R', 'S', 'T'].includes(fila)) return 'vip';
    return 'estandar';
  }

  private obtenerSesionToken(): string {
    if (typeof sessionStorage === 'undefined') return '00000000-0000-4000-8000-000000000001';
    const existente = sessionStorage.getItem(SESSION_KEY);
    if (existente) return existente;
    const nuevo = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, nuevo);
    return nuevo;
  }

  private async calcularHash(token: string): Promise<string> {
    const bytes = new TextEncoder().encode(token);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(valor => valor.toString(16).padStart(2, '0')).join('');
  }

  private desconectarCanal(): void {
    if (this.channel && this.supabase.client) void this.supabase.client.removeChannel(this.channel);
    this.channel = undefined;
  }

  private readonly recibirCambioDemo = (evento: StorageEvent): void => {
    if (evento.key === DEMO_KEY) this.cargarDemo();
  };
}
