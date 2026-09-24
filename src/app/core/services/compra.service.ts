import { computed, inject, Injectable, signal } from '@angular/core';
import { ComboCompra, EntradaCompra, Compra, DatosConfirmacionCompra, ProductoCompra, ResultadoCompraRpc } from '../models/compra.interface';
import { Pelicula } from '../models/pelicula.interface';
import { FuncionDetalle } from '../models/programacion.interface';
import { cumpleRestriccionEdad, fechaHoraFuncion, puedeCancelarCompra } from '../utils/compras';
import { calcularEntradasFueraDeCombos } from '../utils/combo-compra';
import { calcularDescuento } from '../utils/cupones';
import { calcularPuntosCompra } from '../utils/fidelizacion';
import { ventaHabilitada } from '../utils/estrenos';
import { AuthService } from './auth.service';
import { ButacasService } from './butacas.service';
import { ComboCandyService } from './combo-candy.service';
import { CuponService } from './cupon.service';
import { PeliculaService } from './pelicula.service';
import { ProductoService } from './producto.service';
import { SupabaseService } from './supabase.service';

const DEMO_COMPRAS_KEY = 'umbral-demo-compras';

@Injectable({ providedIn: 'root' })
export class CompraService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly butacas = inject(ButacasService);
  private readonly peliculas = inject(PeliculaService);
  private readonly productos = inject(ProductoService);
  private readonly combosCandy = inject(ComboCandyService);
  private readonly cupones = inject(CuponService);
  private readonly comprasSignal = signal<Compra[]>([]);

  readonly compras = computed(() => this.comprasSignal());
  readonly cargando = signal(false);
  readonly procesando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  async confirmar(
    datos: DatosConfirmacionCompra,
    funcion: FuncionDetalle,
    pelicula: Pelicula,
    fechaFuncion: string,
    entradas: EntradaCompra[],
    productos: ProductoCompra[] = [],
    combos: ComboCompra[] = [],
    cuponId: string | null = null
  ): Promise<Compra> {
    if (!entradas.length) throw new Error('La reserva no tiene butacas. Volvé al mapa y elegí tus lugares.');
    this.procesando.set(true);
    this.error.set(null);
    this.mensaje.set(null);

    try {
      const ahora = new Date();
      const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
      if (!ventaHabilitada(pelicula, hoy)) {
        throw new Error('La venta de entradas todavía no comenzó.');
      }
      const compra = this.supabase.client
        ? await this.confirmarSupabase(datos, funcion, pelicula, fechaFuncion, entradas, productos, combos, cuponId)
        : await this.confirmarDemo(datos, funcion, pelicula, fechaFuncion, entradas, productos, combos, cuponId);
      this.mensaje.set(compra.puntos_ganados > 0
        ? `Compra confirmada. Sumaste ${compra.puntos_ganados} puntos.`
        : productos.length || combos.length
          ? 'Compra confirmada. Tus entradas y productos quedaron en la misma operación.'
          : 'Compra confirmada. Tu entrada ya está lista.');
      return compra;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo completar la compra.';
      this.error.set(mensaje);
      throw new Error(mensaje);
    } finally {
      this.procesando.set(false);
    }
  }

  async cargarCompras(): Promise<void> {
    const perfil = this.auth.currentUserData();
    if (!perfil) {
      this.comprasSignal.set([]);
      return;
    }

    const client = this.supabase.client;
    if (!client) {
      this.comprasSignal.set(this.leerComprasDemo()
        .filter(compra => compra.usuario_id === perfil.id)
        .sort((a, b) => b.creada_en.localeCompare(a.creada_en)));
      return;
    }

    this.cargando.set(true);
    this.error.set(null);
    const { data, error } = await client.from('compras_detalle').select('*').order('creada_en', { ascending: false });
    if (error) {
      console.error('No se pudieron cargar las compras:', error.message);
      this.error.set('No se pudieron cargar tus entradas. Revisá la migración del punto 4.6.');
    } else {
      this.comprasSignal.set((data ?? []).map(item => this.normalizarCompra(item as unknown as Compra)));
    }
    this.cargando.set(false);
  }

  async cancelar(compra: Compra): Promise<void> {
    this.procesando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      const client = this.supabase.client;
      if (client) {
        const { error } = await client.rpc('cancelar_compra', { p_compra_id: compra.id });
        if (error) throw new Error(error.message);
        await Promise.all([this.auth.recargarPerfil(), this.peliculas.cargarPeliculas(), this.cargarCompras()]);
      } else {
        this.cancelarDemo(compra);
      }
      this.mensaje.set(compra.puntos_ganados > 0
        ? 'Compra cancelada. El importe se acreditó en tu cuenta y se descontaron los puntos de esta compra.'
        : 'Compra cancelada. El importe se acreditó en tu cuenta.');
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo cancelar la compra.';
      this.error.set(mensaje);
      throw new Error(mensaje);
    } finally {
      this.procesando.set(false);
    }
  }

  puedeCancelar(compra: Compra, ahora = new Date()): boolean {
    return compra.estado === 'pagada' && !compra.candy_retirado_en && !compra.ingreso_validado_en
      && puedeCancelarCompra(compra.fecha_funcion, compra.hora_inicio, ahora);
  }

  contenidoQr(compra: Compra): string {
    return `UMBRAL|${compra.codigo}|${compra.qr_token}`;
  }

  async generarQrDataUrl(compra: Compra): Promise<string> {
    const QRCode = await import('qrcode');
    return QRCode.toDataURL(this.contenidoQr(compra), {
      errorCorrectionLevel: 'M', margin: 1, width: 320,
      color: { dark: '#111710', light: '#f8f5e9' }
    });
  }

  async descargarEntrada(compra: Compra): Promise<void> {
    const [{ jsPDF }, qr] = await Promise.all([import('jspdf'), this.generarQrDataUrl(compra)]);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const dinero = (centavos: number) => new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 0
    }).format(centavos / 100);
    const fecha = new Intl.DateTimeFormat('es-AR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(`${compra.fecha_funcion}T00:00:00Z`));

    pdf.setFillColor(17, 23, 16);
    pdf.rect(0, 0, 210, 297, 'F');
    pdf.setFillColor(232, 226, 211);
    pdf.roundedRect(16, 18, 178, 261, 3, 3, 'F');
    pdf.setTextColor(17, 23, 16);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('UMBRAL CINE', 28, 34);
    pdf.setTextColor(166, 72, 46);
    pdf.setFontSize(9);
    pdf.text(`ENTRADA / ${compra.codigo}`, 28, 44);
    pdf.setTextColor(17, 23, 16);
    pdf.setFont('times', 'bold');
    pdf.setFontSize(28);
    pdf.text(compra.pelicula_titulo, 28, 61, { maxWidth: 104 });
    pdf.setDrawColor(164, 170, 158);
    pdf.line(28, 72, 182, 72);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('FUNCIÓN', 28, 84);
    pdf.text('SALA', 108, 84);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.text(`${fecha} · ${compra.hora_inicio.slice(0, 5)}`, 28, 93, { maxWidth: 70 });
    pdf.text(`${compra.sala_nombre} · ${compra.formato}`, 108, 93, { maxWidth: 70 });
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('BUTACAS', 28, 112);
    pdf.text('IDIOMA', 108, 112);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(12);
    pdf.text(compra.entradas.map(entrada => entrada.butaca_codigo).join(' · '), 28, 121, { maxWidth: 70 });
    pdf.text(compra.idioma, 108, 121);
    let totalEtiquetaY = 140;
    let totalImporteY = 151;
    if (compra.productos.length) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.text('CANDY BAR', 28, 140);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      const detalleCandy = compra.productos.map(producto => `${producto.cantidad}x ${producto.nombre}`).join(' · ');
      const lineasCandy = pdf.splitTextToSize(detalleCandy, 70).slice(0, 4) as string[];
      pdf.text(lineasCandy, 28, 149);
      totalEtiquetaY = 176;
      totalImporteY = 187;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    if (compra.cupon_codigo && compra.cupon_porcentaje) {
      pdf.text(`CUPÓN ${compra.cupon_codigo} · ${compra.cupon_porcentaje}% DE DESCUENTO`, 28, totalEtiquetaY);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`− ${dinero(compra.descuento_centavos)}`, 28, totalEtiquetaY + 8);
      totalEtiquetaY += 19;
      totalImporteY += 19;
      pdf.setFont('helvetica', 'bold');
    }
    pdf.text('TOTAL', 28, totalEtiquetaY);
    pdf.setFont('times', 'bold');
    pdf.setFontSize(23);
    pdf.text(dinero(compra.total_centavos), 28, totalImporteY);
    pdf.addImage(qr, 'PNG', 119, 136, 58, 58);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(86, 96, 79);
    pdf.text(compra.productos.length
      ? 'El mismo QR permite ingresar a la sala y retirar el candy.'
      : 'Presentá este código QR al ingresar a la sala.', 119, 201, { maxWidth: 58, align: 'center' });
    pdf.setDrawColor(164, 170, 158);
    pdf.line(28, 214, 182, 214);
    pdf.setTextColor(17, 23, 16);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('COMPRADOR', 28, 226);
    pdf.setFont('helvetica', 'normal');
    pdf.text(compra.comprador_email, 28, 235);
    if (compra.aviso_adulto) {
      pdf.setFillColor(220, 115, 80);
      pdf.roundedRect(28, 246, 154, 16, 2, 2, 'F');
      pdf.setTextColor(17, 23, 16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('PELÍCULA RESTRINGIDA · ASISTIR CON UNA PERSONA ADULTA.', 105, 256, { align: 'center' });
    }
    pdf.save(`entrada-${compra.codigo.toLocaleLowerCase()}.pdf`);
  }

  private async confirmarSupabase(
    datos: DatosConfirmacionCompra,
    funcion: FuncionDetalle,
    pelicula: Pelicula,
    fechaFuncion: string,
    entradas: EntradaCompra[],
    productos: ProductoCompra[],
    combos: ComboCompra[],
    cuponId: string | null
  ): Promise<Compra> {
    const client = this.supabase.client;
    if (!client) throw new Error('Supabase no está configurado.');
    const { data, error } = await client.rpc('confirmar_compra', {
      p_funcion_id: funcion.id,
      p_fecha: fechaFuncion,
      p_codigos: entradas.map(entrada => entrada.butaca_codigo),
      p_sesion_token: this.butacas.tokenReserva(),
      p_email: datos.email,
      p_fecha_nacimiento: datos.fecha_nacimiento,
      p_usar_credito: datos.usar_credito,
      p_medio_pago: datos.medio_pago,
      p_productos: productos.map(producto => ({
        producto_id: producto.producto_id,
        cantidad: producto.cantidad
      })),
      p_combos: combos.map(combo => ({
        combo_id: combo.combo_id,
        cantidad: combo.cantidad
      })),
      p_cupon_id: cuponId
    });
    if (error) throw new Error(error.message);
    const resultado = (Array.isArray(data) ? data[0] : data) as ResultadoCompraRpc | null;
    if (!resultado) throw new Error('Supabase no devolvió los datos de la compra.');

    const compra = this.desdeResultado(resultado, funcion, pelicula, fechaFuncion, entradas);
    await this.butacas.marcarCompraConfirmada();
    await Promise.all([this.auth.recargarPerfil(), this.peliculas.cargarPeliculas()]);
    if (this.auth.currentUserData()) await this.cargarCompras();
    return compra;
  }

  private async confirmarDemo(
    datos: DatosConfirmacionCompra,
    funcion: FuncionDetalle,
    pelicula: Pelicula,
    fechaFuncion: string,
    entradas: EntradaCompra[],
    productos: ProductoCompra[],
    combos: ComboCompra[],
    cuponId: string | null
  ): Promise<Compra> {
    const codigos = entradas.map(entrada => entrada.butaca_codigo).sort();
    const seleccionadas = [...this.butacas.seleccionadas()].sort();
    if (codigos.join('|') !== seleccionadas.join('|')) {
      throw new Error('La reserva cambió. Volvé al mapa y revisá las butacas seleccionadas.');
    }
    const ahoraMs = Date.now();
    const reservasActivas = this.butacas.reservas().filter(reserva =>
      codigos.includes(reserva.butaca_codigo) &&
      reserva.estado === 'reservada' &&
      Boolean(reserva.expira_en && new Date(reserva.expira_en).getTime() > ahoraMs)
    );
    if (reservasActivas.length !== codigos.length) {
      throw new Error('La reserva venció o una de las butacas ya no está disponible.');
    }
    if (fechaHoraFuncion(fechaFuncion, funcion.hora_inicio).getTime() <= ahoraMs) {
      throw new Error('La función ya comenzó.');
    }

    const perfil = this.auth.currentUserData();
    const nacimiento = perfil?.fecha_nacimiento ?? datos.fecha_nacimiento;
    if (!cumpleRestriccionEdad(nacimiento, fechaFuncion, pelicula.clasificacion)) {
      throw new Error(`La clasificación ${pelicula.clasificacion} no permite completar la compra con la edad informada.`);
    }

    const productosPublicados = new Map(this.productos.publicados().map(producto => [producto.id, producto]));
    const productosIndividuales = productos.map(item => {
      const producto = productosPublicados.get(item.producto_id);
      if (!producto || !Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > 20) {
        throw new Error('Uno de los productos del candy ya no está disponible. Revisá la selección.');
      }
      return {
        producto_id: producto.id,
        nombre: producto.nombre,
        cantidad: item.cantidad,
        precio_unitario_centavos: producto.precio_centavos,
        subtotal_centavos: producto.precio_centavos * item.cantidad
      };
    });
    const combosPublicados = new Map(this.combosCandy.publicados().map(combo => [combo.id, combo]));
    const combosConfirmados = combos.map(item => {
      const combo = combosPublicados.get(item.combo_id);
      if (!combo || !Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > 20) {
        throw new Error('Uno de los combos ya no está disponible. Revisá la selección.');
      }
      return {
        combo_id: combo.id,
        nombre: combo.nombre,
        cantidad: item.cantidad,
        precio_unitario_centavos: combo.precio_centavos,
        subtotal_centavos: combo.precio_centavos * item.cantidad
      };
    });
    const cantidadCombos = combosConfirmados.reduce((suma, combo) => suma + combo.cantidad, 0);
    if (cantidadCombos > entradas.length) throw new Error('Solo se puede comprar un combo por entrada.');

    const cantidadesProductos = new Map<string, number>();
    for (const producto of productosIndividuales) cantidadesProductos.set(producto.producto_id, producto.cantidad);
    for (const item of combosConfirmados) {
      const combo = combosPublicados.get(item.combo_id)!;
      cantidadesProductos.set(combo.pochoclos_producto_id, (cantidadesProductos.get(combo.pochoclos_producto_id) ?? 0) + item.cantidad);
      cantidadesProductos.set(combo.bebida_producto_id, (cantidadesProductos.get(combo.bebida_producto_id) ?? 0) + item.cantidad);
    }
    const productosConfirmados = [...cantidadesProductos].map(([productoId, cantidad]) => {
      const producto = productosPublicados.get(productoId);
      if (!producto) throw new Error('Un producto incluido en el combo ya no está disponible.');
      return {
        producto_id: producto.id, nombre: producto.nombre, cantidad,
        precio_unitario_centavos: producto.precio_centavos,
        subtotal_centavos: producto.precio_centavos * cantidad
      };
    });
    const entradasTotal = calcularEntradasFueraDeCombos(entradas, combosConfirmados);
    const productosTotal = productosIndividuales.reduce((suma, producto) => suma + producto.subtotal_centavos, 0);
    const combosTotal = combosConfirmados.reduce((suma, combo) => suma + combo.subtotal_centavos, 0);
    const subtotal = entradasTotal + productosTotal + combosTotal;
    let cupon = undefined;
    if (cuponId) {
      if (!perfil) throw new Error('Iniciá sesión para usar un cupón.');
      await this.cupones.cargarDisponibles();
      cupon = this.cupones.obtenerDisponible(cuponId);
      if (!cupon) throw new Error('El cupón ya no está disponible para esta compra.');
    }
    const descuento = cupon ? calcularDescuento(subtotal, cupon.porcentaje) : 0;
    const total = subtotal - descuento;
    const puntosGanados = perfil ? calcularPuntosCompra(total) : 0;
    const creditoUsado = perfil && datos.usar_credito ? Math.min(perfil.credito_centavos, total) : 0;
    const pagoOtro = total - creditoUsado;
    const ahora = new Date().toISOString();
    const compra: Compra = {
      id: crypto.randomUUID(),
      codigo: `UMB-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
      usuario_id: perfil?.id ?? null,
      comprador_email: perfil?.email ?? datos.email.trim().toLocaleLowerCase(),
      funcion_id: funcion.id,
      pelicula_id: pelicula.id,
      pelicula_titulo: pelicula.titulo,
      sala_nombre: funcion.sala_nombre,
      fecha_funcion: fechaFuncion,
      hora_inicio: funcion.hora_inicio.slice(0, 5),
      formato: funcion.formato,
      idioma: funcion.idioma,
      entradas_total_centavos: entradasTotal,
      productos_total_centavos: productosTotal,
      combos_total_centavos: combosTotal,
      subtotal_centavos: subtotal,
      descuento_centavos: descuento,
      cupon_id: cupon?.id ?? null,
      cupon_codigo: cupon?.codigo ?? null,
      cupon_porcentaje: cupon?.porcentaje ?? null,
      puntos_ganados: puntosGanados,
      total_centavos: total,
      credito_usado_centavos: creditoUsado,
      pago_otro_centavos: pagoOtro,
      medio_pago: pagoOtro === 0 ? 'credito' : datos.medio_pago,
      estado: 'pagada',
      qr_token: crypto.randomUUID(),
      aviso_adulto: pelicula.clasificacion !== 'ATP',
      creada_en: ahora,
      cancelada_en: null,
      candy_retirado_en: null,
      ingreso_validado_en: null,
      entradas,
      productos: productosConfirmados,
      combos: combosConfirmados
    };

    const compras = [...this.leerComprasDemo(), compra];
    localStorage.setItem(DEMO_COMPRAS_KEY, JSON.stringify(compras));
    if (perfil) {
      this.auth.actualizarCreditoDemo(perfil.credito_centavos - creditoUsado);
      this.auth.actualizarPuntosDemo(perfil.puntos + puntosGanados);
    }
    await this.butacas.marcarCompraConfirmada();
    this.peliculas.actualizarEntradasVendidasDemo(pelicula.id, entradas.length);
    if (perfil) await this.cargarCompras();
    return compra;
  }

  private cancelarDemo(compra: Compra): void {
    const perfil = this.auth.currentUserData();
    if (!perfil || compra.usuario_id !== perfil.id) throw new Error('La compra no pertenece a tu cuenta.');
    if (compra.candy_retirado_en) throw new Error('La compra no puede cancelarse porque el pedido del candy ya fue retirado.');
    if (compra.ingreso_validado_en) throw new Error('La entrada ya fue utilizada y no puede cancelarse.');
    if (!this.puedeCancelar(compra)) throw new Error('La cancelación solo está disponible hasta 2 horas antes de la función.');
    if (perfil.puntos < compra.puntos_ganados) throw new Error('No podés cancelar porque ya utilizaste los puntos obtenidos con esta compra.');

    const canceladaEn = new Date().toISOString();
    const compras = this.leerComprasDemo().map(item => item.id === compra.id
      ? { ...item, estado: 'cancelada' as const, cancelada_en: canceladaEn }
      : item);
    localStorage.setItem(DEMO_COMPRAS_KEY, JSON.stringify(compras));
    this.auth.actualizarCreditoDemo(perfil.credito_centavos + compra.total_centavos);
    this.auth.actualizarPuntosDemo(perfil.puntos - compra.puntos_ganados);
    this.butacas.liberarCompraDemo(compra.funcion_id, compra.fecha_funcion, compra.entradas.map(entrada => entrada.butaca_codigo));
    this.peliculas.actualizarEntradasVendidasDemo(compra.pelicula_id, -compra.entradas.length);
    this.comprasSignal.set(compras.filter(item => item.usuario_id === perfil.id).sort((a, b) => b.creada_en.localeCompare(a.creada_en)));
  }

  private desdeResultado(
    resultado: ResultadoCompraRpc,
    funcion: FuncionDetalle,
    pelicula: Pelicula,
    fechaFuncion: string,
    entradas: EntradaCompra[]
  ): Compra {
    return {
      id: resultado.compra_id,
      codigo: resultado.compra_codigo,
      usuario_id: this.auth.currentUser()?.id ?? null,
      comprador_email: resultado.comprador_email,
      funcion_id: funcion.id,
      pelicula_id: pelicula.id,
      pelicula_titulo: pelicula.titulo,
      sala_nombre: funcion.sala_nombre,
      fecha_funcion: fechaFuncion,
      hora_inicio: funcion.hora_inicio.slice(0, 5),
      formato: funcion.formato,
      idioma: funcion.idioma,
      entradas_total_centavos: Number(resultado.entradas_total_centavos),
      productos_total_centavos: Number(resultado.productos_total_centavos),
      combos_total_centavos: Number(resultado.combos_total_centavos),
      subtotal_centavos: Number(resultado.subtotal_centavos),
      descuento_centavos: Number(resultado.descuento_centavos),
      cupon_id: resultado.cupon_id,
      cupon_codigo: resultado.cupon_codigo,
      cupon_porcentaje: resultado.cupon_porcentaje == null ? null : Number(resultado.cupon_porcentaje),
      puntos_ganados: Number(resultado.puntos_ganados),
      total_centavos: Number(resultado.total_centavos),
      credito_usado_centavos: Number(resultado.credito_usado_centavos),
      pago_otro_centavos: Number(resultado.pago_otro_centavos),
      medio_pago: resultado.medio_pago,
      estado: 'pagada',
      qr_token: resultado.compra_qr_token,
      aviso_adulto: resultado.aviso_adulto,
      creada_en: resultado.creada_en,
      cancelada_en: null,
      candy_retirado_en: null,
      ingreso_validado_en: null,
      entradas,
      productos: this.normalizarProductos(resultado.productos),
      combos: this.normalizarCombos(resultado.combos)
    };
  }

  private leerComprasDemo(): Compra[] {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DEMO_COMPRAS_KEY);
    if (!raw) return [];
    try { return (JSON.parse(raw) as Compra[]).map(compra => this.normalizarCompra(compra)); }
    catch { return []; }
  }

  private normalizarCompra(compra: Compra): Compra {
    const productos = this.normalizarProductos(compra.productos);
    const combos = this.normalizarCombos(compra.combos);
    const productosTotal = compra.productos_total_centavos == null
      ? productos.reduce((total, producto) => total + producto.subtotal_centavos, 0)
      : Number(compra.productos_total_centavos);
    const combosTotal = compra.combos_total_centavos == null
      ? combos.reduce((total, combo) => total + combo.subtotal_centavos, 0)
      : Number(compra.combos_total_centavos);
    const descuento = Number(compra.descuento_centavos ?? 0);
    const subtotal = compra.subtotal_centavos == null
      ? Number(compra.total_centavos) + descuento
      : Number(compra.subtotal_centavos);
    return {
      ...compra,
      hora_inicio: compra.hora_inicio.slice(0, 5),
      entradas_total_centavos: compra.entradas_total_centavos == null
        ? subtotal - productosTotal - combosTotal
        : Number(compra.entradas_total_centavos),
      productos_total_centavos: productosTotal,
      combos_total_centavos: combosTotal,
      subtotal_centavos: subtotal,
      descuento_centavos: descuento,
      cupon_id: compra.cupon_id ?? null,
      cupon_codigo: compra.cupon_codigo ?? null,
      cupon_porcentaje: compra.cupon_porcentaje == null ? null : Number(compra.cupon_porcentaje),
      puntos_ganados: Number(compra.puntos_ganados ?? 0),
      total_centavos: Number(compra.total_centavos),
      credito_usado_centavos: Number(compra.credito_usado_centavos),
      pago_otro_centavos: Number(compra.pago_otro_centavos),
      entradas: Array.isArray(compra.entradas) ? compra.entradas.map(entrada => ({
        ...entrada, precio_centavos: Number(entrada.precio_centavos)
      })) : [],
      candy_retirado_en: compra.candy_retirado_en ?? null,
      ingreso_validado_en: compra.ingreso_validado_en ?? null,
      productos,
      combos
    };
  }

  private normalizarProductos(productos: ProductoCompra[] | null | undefined): ProductoCompra[] {
    return Array.isArray(productos) ? productos.map(producto => ({
      ...producto,
      cantidad: Number(producto.cantidad),
      precio_unitario_centavos: Number(producto.precio_unitario_centavos),
      subtotal_centavos: Number(producto.subtotal_centavos)
    })) : [];
  }

  private normalizarCombos(combos: ComboCompra[] | null | undefined): ComboCompra[] {
    return Array.isArray(combos) ? combos.map(combo => ({
      ...combo,
      cantidad: Number(combo.cantidad),
      precio_unitario_centavos: Number(combo.precio_unitario_centavos),
      subtotal_centavos: Number(combo.subtotal_centavos)
    })) : [];
  }
}
