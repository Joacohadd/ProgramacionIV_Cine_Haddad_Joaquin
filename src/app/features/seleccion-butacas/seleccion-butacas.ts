import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButacaMapa } from '../../core/models/butaca.interface';
import { ButacasService } from '../../core/services/butacas.service';
import { ProgramacionService } from '../../core/services/programacion.service';
import { buscarButaca, generarMapaButacas, PRECIO_BUTACA_CENTAVOS, RECARGO_VIP_CENTAVOS } from '../../core/utils/butacas';
import { proximasFechasFuncion } from '../../core/utils/planificacion';
import { ButacaComponent } from '../../shared/components/butaca/butaca';

@Component({
  selector: 'app-seleccion-butacas',
  imports: [RouterLink, ButacaComponent],
  templateUrl: './seleccion-butacas.html',
  styleUrl: './seleccion-butacas.css'
})
export class SeleccionButacas {
  readonly id = input.required<string>();
  readonly fecha = input<string>();
  readonly programacion = inject(ProgramacionService);
  readonly butacas = inject(ButacasService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hoy = this.fechaISO(new Date());

  readonly fechaSeleccionada = signal('');
  readonly funcion = computed(() => this.programacion.funciones().find(item => item.id === this.id()));
  readonly sala = computed(() => {
    const funcion = this.funcion();
    return funcion ? this.programacion.salas().find(item => item.id === funcion.sala_id) : undefined;
  });
  readonly fechas = computed(() => {
    const funcion = this.funcion();
    return funcion ? proximasFechasFuncion(funcion, this.hoy, 8) : [];
  });
  readonly mapa = computed(() => {
    const sala = this.sala();
    return sala ? generarMapaButacas(sala) : [];
  });
  readonly seleccionadasDetalle = computed(() => this.butacas.seleccionadas()
    .map(codigo => buscarButaca(this.mapa(), codigo))
    .filter((butaca): butaca is ButacaMapa => Boolean(butaca))
    .sort((a, b) => a.codigo.localeCompare(b.codigo)));
  readonly totalCentavos = computed(() => this.seleccionadasDetalle()
    .reduce((total, butaca) => total + butaca.precio_centavos, 0));
  readonly cantidadTexto = computed(() => String(this.butacas.cantidad()).padStart(2, '0'));
  readonly precioBase = PRECIO_BUTACA_CENTAVOS;
  readonly recargoVip = RECARGO_VIP_CENTAVOS;

  constructor() {
    effect(() => {
      const funcion = this.funcion();
      const fechas = this.fechas();
      if (!funcion || !fechas.length) return;
      const actual = this.fechaSeleccionada();
      const solicitada = this.fecha();
      const fecha = fechas.includes(actual) ? actual : solicitada && fechas.includes(solicitada) ? solicitada : fechas[0];
      if (fecha !== actual) this.fechaSeleccionada.set(fecha);
      void this.butacas.conectar(funcion.id, fecha);
    });
    this.destroyRef.onDestroy(() => this.butacas.desconectar());
  }

  seleccionarFecha(fecha: string): void {
    if (!this.butacas.guardando()) this.fechaSeleccionada.set(fecha);
  }

  async alternar(butaca: ButacaMapa): Promise<void> {
    await this.butacas.alternar(butaca);
  }

  continuarCompra(): void {
    const funcion = this.funcion();
    if (!funcion || !this.butacas.cantidad()) return;
    void this.router.navigate(['/funcion', funcion.id, 'compra', this.fechaSeleccionada()]);
  }

  fechaLarga(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC'
    }).format(new Date(`${fecha}T00:00:00Z`)).replace('.', '');
  }

  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 0
    }).format(centavos / 100);
  }

  horaExpiracion(): string {
    const fecha = this.butacas.expiraEn();
    return fecha ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(fecha)) : '';
  }

  private fechaISO(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }
}
