import { inject, Injectable, signal } from '@angular/core';
import { Compra } from '../models/compra.interface';
import { PeriodoReporte, ReporteVentas } from '../models/reporte.interface';
import { construirReporteDemo, rangoReporte } from '../utils/reportes';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

const COMPRAS_DEMO_KEY = 'umbral-demo-compras';

@Injectable({ providedIn: 'root' })
export class ReporteService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private solicitudActual = 0;

  readonly reporte = signal<ReporteVentas | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  async cargar(dia: string, periodo: PeriodoReporte): Promise<void> {
    const solicitud = ++this.solicitudActual;
    this.reporte.set(null);
    this.error.set(null);
    this.cargando.set(true);
    try {
      if (this.auth.currentUserData()?.rol !== 'admin') {
        throw new Error('Solo un administrador puede consultar reportes.');
      }
      rangoReporte(dia, periodo);
      const client = this.supabase.client;
      let reporte: ReporteVentas;
      if (client) {
        const { data, error } = await client.rpc('reporte_ventas_admin', {
          p_dia: dia, p_periodo: periodo
        });
        if (error) throw new Error(error.code === 'PGRST202'
          ? 'Falta aplicar la migración del punto 4.12 en Supabase.'
          : error.message);
        if (!data) throw new Error('No se recibió el reporte solicitado.');
        reporte = this.normalizar(data as unknown as ReporteVentas);
      } else {
        const raw = localStorage.getItem(COMPRAS_DEMO_KEY);
        let compras: Compra[] = [];
        try { compras = raw ? JSON.parse(raw) as Compra[] : []; }
        catch { throw new Error('No se pudieron leer las compras de muestra.'); }
        reporte = construirReporteDemo(compras, dia, periodo);
      }
      if (solicitud === this.solicitudActual) this.reporte.set(reporte);
    } catch (error) {
      if (solicitud === this.solicitudActual) {
        this.error.set(error instanceof Error ? error.message : 'No se pudo consultar el reporte.');
      }
    } finally {
      if (solicitud === this.solicitudActual) this.cargando.set(false);
    }
  }

  private normalizar(reporte: ReporteVentas): ReporteVentas {
    return {
      ...reporte,
      facturacion_centavos: Number(reporte.facturacion_centavos),
      entradas_vendidas: Number(reporte.entradas_vendidas),
      compras: Number(reporte.compras),
      ventas: (reporte.ventas ?? []).map(venta => ({
        ...venta, entradas: Number(venta.entradas), total_centavos: Number(venta.total_centavos)
      })),
      peliculas: (reporte.peliculas ?? []).map(pelicula => ({
        ...pelicula, entradas: Number(pelicula.entradas)
      })),
      producto_mas_vendido: reporte.producto_mas_vendido
        ? { ...reporte.producto_mas_vendido,
            cantidad: Number(reporte.producto_mas_vendido.cantidad) }
        : null
    };
  }
}
