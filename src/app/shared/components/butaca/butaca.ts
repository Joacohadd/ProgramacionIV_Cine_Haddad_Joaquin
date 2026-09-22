import { Component, input, output } from '@angular/core';
import { ButacaMapa, EstadoVisualButaca } from '../../../core/models/butaca.interface';

@Component({
  selector: 'app-butaca',
  templateUrl: './butaca.html',
  styleUrl: './butaca.css'
})
export class ButacaComponent {
  readonly butaca = input.required<ButacaMapa>();
  readonly estado = input.required<EstadoVisualButaca>();
  readonly cambio = output<ButacaMapa>();

  get bloqueada(): boolean {
    return this.estado() === 'reservada' || this.estado() === 'ocupada';
  }

  get etiqueta(): string {
    const lugar = this.butaca();
    const tipo = lugar.tipo === 'estandar' ? '' : `, ${lugar.tipo}`;
    return `Butaca ${lugar.codigo}${tipo}, ${this.estado()}`;
  }
}
