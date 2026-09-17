import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'duracion' })
export class DuracionPipe implements PipeTransform {
  transform(minutos: number): string {
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return horas ? `${horas} h ${resto ? `${resto} min` : ''}`.trim() : `${resto} min`;
  }
}
