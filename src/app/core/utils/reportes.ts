import { Compra } from '../models/compra.interface';
import { PeriodoReporte, ReporteVentas } from '../models/reporte.interface';

const fechaArgentina = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function diaVentaArgentina(iso: string): string {
  const partes = fechaArgentina.formatToParts(new Date(iso));
  const valor = (tipo: string) => partes.find(parte => parte.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

export function rangoReporte(dia: string, periodo: PeriodoReporte): { desde: string; hasta: string } {
  const fecha = new Date(`${dia}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== dia) {
    throw new Error('Elegí una fecha válida para consultar el reporte.');
  }
  if (periodo === 'semana') {
    fecha.setUTCDate(fecha.getUTCDate() - (fecha.getUTCDay() + 6) % 7);
  } else {
    fecha.setUTCDate(1);
  }
  const desde = fecha.toISOString().slice(0, 10);
  if (periodo === 'semana') fecha.setUTCDate(fecha.getUTCDate() + 6);
  else {
    fecha.setUTCMonth(fecha.getUTCMonth() + 1);
    fecha.setUTCDate(0);
  }
  return { desde, hasta: fecha.toISOString().slice(0, 10) };
}

export function construirReporteDemo(compras: Compra[], dia: string, periodo: PeriodoReporte): ReporteVentas {
  const { desde, hasta } = rangoReporte(dia, periodo);
  const pagadas = compras.filter(compra => compra.estado === 'pagada');
  const delDia = pagadas.filter(compra => diaVentaArgentina(compra.creada_en) === dia)
    .sort((a, b) => b.creada_en.localeCompare(a.creada_en));
  const peliculas = new Map<string, { titulo: string; entradas: number }>();
  const productos = new Map<string, { nombre: string; cantidad: number }>();

  for (const compra of pagadas) {
    if (compra.fecha_funcion >= desde && compra.fecha_funcion <= hasta) {
      const anterior = peliculas.get(compra.pelicula_id);
      peliculas.set(compra.pelicula_id, {
        titulo: compra.pelicula_titulo,
        entradas: (anterior?.entradas ?? 0) + compra.entradas.length
      });
    }
    for (const producto of compra.productos ?? []) {
      const anterior = productos.get(producto.producto_id);
      productos.set(producto.producto_id, {
        nombre: producto.nombre,
        cantidad: (anterior?.cantidad ?? 0) + Number(producto.cantidad)
      });
    }
  }

  const masVendido = [...productos.entries()]
    .sort((a, b) => b[1].cantidad - a[1].cantidad || a[1].nombre.localeCompare(b[1].nombre))[0];

  return {
    dia, periodo, periodo_desde: desde, periodo_hasta: hasta,
    facturacion_centavos: delDia.reduce((total, compra) => total + Number(compra.total_centavos), 0),
    entradas_vendidas: delDia.reduce((total, compra) => total + compra.entradas.length, 0),
    compras: delDia.length,
    ventas: delDia.map(compra => ({
      codigo: compra.codigo, creada_en: compra.creada_en, pelicula: compra.pelicula_titulo,
      entradas: compra.entradas.length, total_centavos: Number(compra.total_centavos)
    })),
    peliculas: [...peliculas.entries()]
      .map(([pelicula_id, datos]) => ({ pelicula_id, ...datos }))
      .sort((a, b) => b.entradas - a.entradas || a.titulo.localeCompare(b.titulo)),
    producto_mas_vendido: masVendido
      ? { producto_id: masVendido[0], ...masVendido[1] }
      : null
  };
}
