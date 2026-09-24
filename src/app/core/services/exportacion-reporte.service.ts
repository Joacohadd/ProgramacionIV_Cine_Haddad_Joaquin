import { Injectable } from '@angular/core';
import { ReporteVentas } from '../models/reporte.interface';

const dinero = (centavos: number) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS'
}).format(centavos / 100);

const hora = (iso: string) => new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit'
}).format(new Date(iso));

@Injectable({ providedIn: 'root' })
export class ExportacionReporteService {
  async pdf(reporte: ReporteVentas): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const documento = new jsPDF({ unit: 'mm', format: 'a4' });
    const ancho = 210;
    let y = 57;

    documento.setFillColor(17, 23, 16);
    documento.rect(0, 0, ancho, 43, 'F');
    documento.setTextColor(248, 245, 233);
    documento.setFont('times', 'bold');
    documento.setFontSize(25);
    documento.text('Umbral / facturación diaria', 16, 23);
    documento.setFont('helvetica', 'normal');
    documento.setFontSize(10);
    documento.text(`Fecha de venta: ${reporte.dia}`, 16, 34);
    documento.setTextColor(17, 23, 16);
    documento.setFont('helvetica', 'bold');
    documento.setFontSize(12);
    documento.text(`Total facturado: ${dinero(reporte.facturacion_centavos)}`, 16, y);
    y += 8;
    documento.setFont('helvetica', 'normal');
    documento.setFontSize(10);
    documento.text(`${reporte.entradas_vendidas} entradas vendidas · ${reporte.compras} compras`, 16, y);
    y += 16;

    const encabezado = () => {
      documento.setFillColor(230, 225, 211);
      documento.rect(16, y - 6, 178, 10, 'F');
      documento.setFont('helvetica', 'bold');
      documento.text('HORA', 19, y);
      documento.text('CÓDIGO', 42, y);
      documento.text('PELÍCULA', 85, y);
      documento.text('ENT.', 156, y);
      documento.text('TOTAL', 191, y, { align: 'right' });
      documento.setFont('helvetica', 'normal');
      y += 11;
    };
    encabezado();
    if (!reporte.ventas.length) {
      documento.text('No hubo ventas vigentes en esta fecha.', 19, y);
    }
    for (const venta of reporte.ventas) {
      if (y > 275) {
        documento.addPage();
        y = 20;
        encabezado();
      }
      documento.text(hora(venta.creada_en), 19, y);
      documento.text(venta.codigo, 42, y);
      documento.text(venta.pelicula.slice(0, 29), 85, y);
      documento.text(String(venta.entradas), 158, y);
      documento.text(dinero(venta.total_centavos), 191, y, { align: 'right' });
      documento.setDrawColor(221, 221, 214);
      documento.line(16, y + 3, 194, y + 3);
      y += 11;
    }
    documento.save(`facturacion-${reporte.dia}.pdf`);
  }

  async excel(reporte: ReporteVentas): Promise<void> {
    const ExcelJS = (await import('exceljs')).default;
    const libro = new ExcelJS.Workbook();
    libro.creator = 'Umbral Cine';
    const hoja = libro.addWorksheet('Facturación diaria');
    hoja.columns = [
      { header: 'Hora', key: 'hora', width: 12 },
      { header: 'Código', key: 'codigo', width: 21 },
      { header: 'Película', key: 'pelicula', width: 38 },
      { header: 'Entradas', key: 'entradas', width: 13 },
      { header: 'Total (ARS)', key: 'total', width: 20 }
    ];
    hoja.addRow([`Facturación del ${reporte.dia}`]);
    hoja.addRow(['Total facturado', '', '', '', reporte.facturacion_centavos / 100]);
    hoja.addRow(['Entradas vendidas', '', '', reporte.entradas_vendidas]);
    hoja.addRow([]);
    for (const venta of reporte.ventas) {
      hoja.addRow({
        hora: hora(venta.creada_en), codigo: venta.codigo,
        pelicula: venta.pelicula, entradas: venta.entradas,
        total: venta.total_centavos / 100
      });
    }
    hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17251A' } };
    hoja.getRow(2).font = { bold: true };
    hoja.getColumn('E').numFmt = '#,##0.00';
    hoja.views = [{ state: 'frozen', ySplit: 1 }];
    const contenido = await libro.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([contenido as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `facturacion-${reporte.dia}.xlsx`;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
