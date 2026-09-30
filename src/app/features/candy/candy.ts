import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Compra, DatosConfirmacionCompra } from '../../core/models/compra.interface';
import { AuthService } from '../../core/services/auth.service';
import { CompraService } from '../../core/services/compra.service';
import { ProductoService } from '../../core/services/producto.service';
import { FidelizacionService } from '../../core/services/fidelizacion.service';
import { descuentoCanjes, productosConCanjes } from '../../core/utils/aplicacion-canjes';
import { armarProductosCompra, calcularTotalProductos, MAXIMO_PRODUCTOS_POR_ITEM } from '../../core/utils/candy-compra';
import { ProductoCard } from '../../shared/components/producto-card/producto-card';
import { RoleDirective } from '../../shared/directives/role.directive';

@Component({
  selector: 'app-candy',
  imports: [RouterLink, ReactiveFormsModule, ProductoCard, RoleDirective],
  templateUrl: './candy.html',
  styleUrl: './candy.css'
})
export class Candy implements OnInit {
  readonly servicio = inject(ProductoService);
  readonly auth = inject(AuthService);
  readonly compras = inject(CompraService);
  readonly fidelizacion = inject(FidelizacionService);
  private readonly fb = inject(FormBuilder);
  readonly cantidades = signal<Record<string, number>>({});
  readonly codigosCanjes = signal<string[]>([]);
  readonly seleccionados = computed(() => armarProductosCompra(this.servicio.publicados(), this.cantidades()));
  readonly canjesDisponibles = computed(() => this.fidelizacion.canjes().filter(canje => canje.tipo === 'producto' && !canje.entregado_en));
  readonly canjesSeleccionados = computed(() => this.canjesDisponibles().filter(canje => this.codigosCanjes().includes(canje.codigo)));
  readonly aplicacionCanjes = computed(() => {
    try {
      const canjes = this.canjesSeleccionados();
      return { productos: productosConCanjes(this.seleccionados(), canjes, this.servicio.publicados()),
        descuento: descuentoCanjes(canjes, [], [], this.servicio.publicados()), error: null as string | null };
    } catch (error) {
      return { productos: this.seleccionados(), descuento: 0,
        error: error instanceof Error ? error.message : 'Revisá los premios seleccionados.' };
    }
  });
  readonly subtotal = computed(() => calcularTotalProductos(this.aplicacionCanjes().productos));
  readonly total = computed(() => this.subtotal() - this.aplicacionCanjes().descuento);
  readonly credito = computed(() => Math.min(this.auth.currentUserData()?.credito_centavos ?? 0, this.total()));
  readonly compraFinalizada = signal<Compra | null>(null);
  readonly qrDataUrl = signal<string | null>(null);
  readonly errorDocumento = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    usar_credito: [false],
    medio_pago: this.fb.nonNullable.control<DatosConfirmacionCompra['medio_pago']>('tarjeta_credito', Validators.required)
  });
  private readonly usarCredito = toSignal(this.form.controls.usar_credito.valueChanges, {
    initialValue: this.form.controls.usar_credito.value
  });
  readonly creditoAplicado = computed(() => this.usarCredito() ? this.credito() : 0);
  readonly saldoAPagar = computed(() => this.total() - this.creditoAplicado());

  constructor() {
    effect(() => {
      const perfil = this.auth.currentUserData();
      if (perfil) {
        this.form.controls.email.setValue(perfil.email, { emitEvent: false });
        void this.fidelizacion.cargarPerfil();
      } else this.codigosCanjes.set([]);
    });
  }

  ngOnInit(): void { void this.servicio.cargar(); }

  cantidad(id: string): number { return this.cantidades()[id] ?? 0; }

  cambiarCanje(codigo: string, marcado: boolean): void {
    this.codigosCanjes.update(codigos => marcado ? [...codigos, codigo] : codigos.filter(item => item !== codigo));
  }

  cambiarCantidad(id: string, diferencia: number): void {
    this.cantidades.update(actual => {
      const cantidad = Math.max(0, Math.min(MAXIMO_PRODUCTOS_POR_ITEM, (actual[id] ?? 0) + diferencia));
      const nuevo = { ...actual };
      if (cantidad) nuevo[id] = cantidad;
      else delete nuevo[id];
      return nuevo;
    });
  }

  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(centavos / 100);
  }

  async comprar(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.aplicacionCanjes().productos.length || this.aplicacionCanjes().error) return;
    let compra: Compra;
    try {
      compra = await this.compras.confirmarSoloCandy(this.form.getRawValue(), this.aplicacionCanjes().productos, this.codigosCanjes());
      await this.fidelizacion.cargarPerfil();
    } catch { return; /* El servicio muestra el error de la compra. */ }
    this.compraFinalizada.set(compra);
    try { this.qrDataUrl.set(await this.compras.generarQrDataUrl(compra)); }
    catch { this.errorDocumento.set('El pedido está confirmado, pero no se pudo mostrar el QR. Descargá el comprobante.'); }
    await this.descargar();
  }

  async descargar(): Promise<void> {
    const compra = this.compraFinalizada();
    if (!compra) return;
    this.errorDocumento.set(null);
    try { await this.compras.descargarEntrada(compra); }
    catch { this.errorDocumento.set('El pedido está confirmado, pero no se pudo generar el PDF. Intentá nuevamente.'); }
  }
}
