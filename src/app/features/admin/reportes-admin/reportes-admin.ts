import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PeriodoReporte, ReporteVentas } from '../../../core/models/reporte.interface';
import { ExportacionReporteService } from '../../../core/services/exportacion-reporte.service';
import { ReporteService } from '../../../core/services/reporte.service';
import { diaVentaArgentina } from '../../../core/utils/reportes';

@Component({
  selector: 'app-reportes-admin',
  imports: [RouterLink],
  templateUrl: './reportes-admin.html',
  styleUrl: './reportes-admin.css'
})
export class ReportesAdmin implements OnInit {
  readonly servicio = inject(ReporteService);
  private readonly exportacion = inject(ExportacionReporteService);
  readonly dia = signal(diaVentaArgentina(new Date().toISOString()));
  readonly periodo = signal<PeriodoReporte>('semana');
  readonly descargando = signal<'pdf' | 'excel' | null>(null);
  readonly errorDescarga = signal<string | null>(null);
  readonly maximoEntradas = computed(() => Math.max(1,
    ...this.servicio.reporte()?.peliculas.map(pelicula => pelicula.entradas) ?? []));

  ngOnInit(): void {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.errorDescarga.set(null);
    await this.servicio.cargar(this.dia(), this.periodo());
  }

  cambiarDia(dia: string): void {
    this.dia.set(dia);
    void this.cargar();
  }

  cambiarPeriodo(periodo: PeriodoReporte): void {
    if (periodo === this.periodo()) return;
    this.periodo.set(periodo);
    void this.cargar();
  }

  async descargar(formato: 'pdf' | 'excel'): Promise<void> {
    const reporte = this.servicio.reporte();
    if (!reporte || this.descargando()) return;
    this.descargando.set(formato);
    this.errorDescarga.set(null);
    try {
      if (formato === 'pdf') await this.exportacion.pdf(reporte);
      else await this.exportacion.excel(reporte);
    } catch (error) {
      this.errorDescarga.set(error instanceof Error ? error.message : 'No se pudo exportar el reporte.');
    } finally {
      this.descargando.set(null);
    }
  }

  anchoBarra(entradas: number): number {
    return Math.round(entradas / this.maximoEntradas() * 100);
  }

  dinero(centavos: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS'
    }).format(centavos / 100);
  }

  fecha(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(`${fecha}T00:00:00Z`));
  }

  hora(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit'
    }).format(new Date(fecha));
  }

  periodoTexto(reporte: ReporteVentas): string {
    return `${this.fecha(reporte.periodo_desde)} — ${this.fecha(reporte.periodo_hasta)}`;
  }
}
