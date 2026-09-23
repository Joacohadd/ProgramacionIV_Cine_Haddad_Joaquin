import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButacaMapa } from '../../core/models/butaca.interface';
import { Compra, DatosConfirmacionCompra, EntradaCompra } from '../../core/models/compra.interface';
import { AuthService } from '../../core/services/auth.service';
import { ButacasService } from '../../core/services/butacas.service';
import { CompraService } from '../../core/services/compra.service';
import { ComboCandyService } from '../../core/services/combo-candy.service';
import { CuponService } from '../../core/services/cupon.service';
import { PeliculaService } from '../../core/services/pelicula.service';
import { ProgramacionService } from '../../core/services/programacion.service';
import { ProductoService } from '../../core/services/producto.service';
import { buscarButaca, generarMapaButacas } from '../../core/utils/butacas';
import { armarProductosCompra, calcularTotalProductos, MAXIMO_PRODUCTOS_POR_ITEM } from '../../core/utils/candy-compra';
import { cumpleRestriccionEdad, edadMinima } from '../../core/utils/compras';
import { armarCombosCompra, calcularEntradasFueraDeCombos, calcularTotalCombos } from '../../core/utils/combo-compra';
import { calcularDescuento } from '../../core/utils/cupones';

@Component({
  selector: 'app-checkout',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './checkout.html',
  styleUrl: './checkout.css'
})
export class Checkout {
  readonly id = input.required<string>();
  readonly fecha = input.required<string>();
  readonly auth = inject(AuthService);
  readonly butacas = inject(ButacasService);
  readonly compras = inject(CompraService);
  readonly programacion = inject(ProgramacionService);
  readonly candy = inject(ProductoService);
  readonly combos = inject(ComboCandyService);
  readonly cupones = inject(CuponService);
  private readonly peliculas = inject(PeliculaService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly compraFinalizada = signal<Compra | null>(null);
  readonly qrDataUrl = signal<string | null>(null);
  readonly errorDocumento = signal<string | null>(null);
  readonly cantidadesCandy = signal<Record<string, number>>({});
  readonly cantidadesCombos = signal<Record<string, number>>({});
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    fecha_nacimiento: ['', Validators.required],
    cupon_id: [''],
    usar_credito: [false],
    medio_pago: this.fb.nonNullable.control<DatosConfirmacionCompra['medio_pago']>('tarjeta_credito', Validators.required)
  });
  private readonly nacimientoIngresado = toSignal(this.form.controls.fecha_nacimiento.valueChanges, {
    initialValue: this.form.controls.fecha_nacimiento.value
  });
  private readonly usarCredito = toSignal(this.form.controls.usar_credito.valueChanges, {
    initialValue: this.form.controls.usar_credito.value
  });
  private readonly cuponElegidoId = toSignal(this.form.controls.cupon_id.valueChanges, {
    initialValue: this.form.controls.cupon_id.value
  });

  readonly funcion = computed(() => this.programacion.funciones().find(item => item.id === this.id()));
  readonly pelicula = computed(() => {
    const funcion = this.funcion();
    return funcion ? this.peliculas.peliculas().find(item => item.id === funcion.pelicula_id) : undefined;
  });
  readonly sala = computed(() => {
    const funcion = this.funcion();
    return funcion ? this.programacion.salas().find(item => item.id === funcion.sala_id) : undefined;
  });
  readonly fechaProgramada = computed(() => {
    const funcion = this.funcion();
    const fecha = this.fecha();
    if (!funcion || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < funcion.fecha_desde || fecha > funcion.fecha_hasta) return false;
    const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay() || 7;
    return funcion.dias_semana.includes(dia as typeof funcion.dias_semana[number]);
  });
  readonly mapa = computed(() => this.sala() ? generarMapaButacas(this.sala()!) : []);
  readonly entradas = computed<EntradaCompra[]>(() => this.butacas.seleccionadas()
    .map(codigo => buscarButaca(this.mapa(), codigo))
    .filter((butaca): butaca is ButacaMapa => Boolean(butaca))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .map(butaca => ({
      butaca_codigo: butaca.codigo,
      tipo: butaca.tipo,
      precio_centavos: butaca.precio_centavos
    })));
  readonly productosSeleccionados = computed(() => armarProductosCompra(this.candy.publicados(), this.cantidadesCandy()));
  readonly combosSeleccionados = computed(() => armarCombosCompra(this.combos.publicados(), this.cantidadesCombos(), this.entradas().length));
  readonly cantidadCombos = computed(() => this.combosSeleccionados().reduce((total, combo) => total + combo.cantidad, 0));
  readonly subtotalEntradas = computed(() => calcularEntradasFueraDeCombos(this.entradas(), this.combosSeleccionados()));
  readonly subtotalCombos = computed(() => calcularTotalCombos(this.combosSeleccionados()));
  readonly subtotalCandy = computed(() => calcularTotalProductos(this.productosSeleccionados()));
  readonly subtotalCompra = computed(() => this.subtotalEntradas() + this.subtotalCombos() + this.subtotalCandy());
  readonly cuponElegido = computed(() => this.cupones.disponibles().find(cupon => cupon.id === this.cuponElegidoId()));
  readonly descuentoCentavos = computed(() => {
    const cupon = this.cuponElegido();
    return cupon ? calcularDescuento(this.subtotalCompra(), cupon.porcentaje) : 0;
  });
  readonly totalCentavos = computed(() => this.subtotalCompra() - this.descuentoCentavos());
  readonly creditoDisponible = computed(() => this.auth.currentUserData()?.credito_centavos ?? 0);
  readonly creditoAplicado = computed(() => this.usarCredito()
    ? Math.min(this.creditoDisponible(), this.totalCentavos())
    : 0);
  readonly saldoAPagar = computed(() => this.totalCentavos() - this.creditoAplicado());
  readonly edadPermitida = computed(() => {
    const pelicula = this.pelicula();
    const nacimiento = this.auth.currentUserData()?.fecha_nacimiento ?? this.nacimientoIngresado();
    return pelicula && nacimiento
      ? cumpleRestriccionEdad(nacimiento, this.fecha(), pelicula.clasificacion)
      : true;
  });
  readonly edadRequerida = computed(() => edadMinima(this.pelicula()?.clasificacion ?? 'ATP'));

  constructor() {
    void this.combos.cargar();
    effect(() => {
      const funcion = this.funcion();
      const fecha = this.fecha();
      if (funcion && this.fechaProgramada()) void this.butacas.conectar(funcion.id, fecha);
    });
    effect(() => {
      const perfil = this.auth.currentUserData();
      if (perfil) {
        this.form.patchValue({ email: perfil.email, fecha_nacimiento: perfil.fecha_nacimiento }, { emitEvent: true });
      } else {
        this.form.controls.cupon_id.setValue('');
      }
      void this.cupones.cargarDisponibles();
    });
    this.destroyRef.onDestroy(() => this.butacas.desconectar());
  }

  async confirmarCompra(): Promise<void> {
    this.form.markAllAsTouched();
    const funcion = this.funcion();
    const pelicula = this.pelicula();
    if (this.form.invalid || !funcion || !pelicula || !this.fechaProgramada() || !this.entradas().length) return;
    if (!this.edadPermitida()) {
      this.compras.error.set(`Necesitás tener al menos ${this.edadRequerida()} años en la fecha de la función.`);
      return;
    }

    const valores = this.form.getRawValue();
    try {
      const resultado = await this.compras.confirmar({
        email: valores.email,
        fecha_nacimiento: valores.fecha_nacimiento,
        usar_credito: valores.usar_credito,
        medio_pago: valores.medio_pago
      }, funcion, pelicula, this.fecha(), this.entradas(), this.productosSeleccionados(), this.combosSeleccionados(), this.cuponElegido()?.id ?? null);
      this.compraFinalizada.set(resultado);
      this.qrDataUrl.set(await this.compras.generarQrDataUrl(resultado));
      await this.descargar(resultado);
    } catch {
      // El servicio expone el mensaje correspondiente en la página.
    }
  }

  async descargar(compra = this.compraFinalizada()): Promise<void> {
    if (!compra) return;
    this.errorDocumento.set(null);
    try {
      await this.compras.descargarEntrada(compra);
    } catch (error) {
      console.error('No se pudo generar el PDF:', error);
      this.errorDocumento.set('La compra está confirmada, pero el PDF no pudo descargarse. Intentá nuevamente.');
    }
  }

  cantidadProducto(productoId: string): number {
    return this.cantidadesCandy()[productoId] ?? 0;
  }

  cambiarCantidad(productoId: string, diferencia: number): void {
    this.cantidadesCandy.update(cantidades => {
      const actual = cantidades[productoId] ?? 0;
      const cantidad = Math.max(0, Math.min(MAXIMO_PRODUCTOS_POR_ITEM, actual + diferencia));
      if (cantidad === actual) return cantidades;
      const actualizadas = { ...cantidades };
      if (cantidad === 0) delete actualizadas[productoId];
      else actualizadas[productoId] = cantidad;
      return actualizadas;
    });
  }

  cantidadCombo(comboId: string): number {
    return this.cantidadesCombos()[comboId] ?? 0;
  }

  puedeAgregarCombo(): boolean {
    return this.cantidadCombos() < this.entradas().length;
  }

  cambiarCantidadCombo(comboId: string, diferencia: number): void {
    this.cantidadesCombos.update(cantidades => {
      const actual = cantidades[comboId] ?? 0;
      if (diferencia > 0 && !this.puedeAgregarCombo()) return cantidades;
      const cantidad = Math.max(0, Math.min(20, actual + diferencia));
      if (cantidad === actual) return cantidades;
      const actualizadas = { ...cantidades };
      if (cantidad === 0) delete actualizadas[comboId];
      else actualizadas[comboId] = cantidad;
      return actualizadas;
    });
  }

  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 0
    }).format(centavos / 100);
  }

  fechaLarga(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(`${fecha}T00:00:00Z`));
  }

  horaExpiracion(): string {
    const fecha = this.butacas.expiraEn();
    return fecha ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(fecha)) : '';
  }
}
