import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-calificacion-estrellas',
  templateUrl: './calificacion-estrellas.html',
  styleUrl: './calificacion-estrellas.css'
})
export class CalificacionEstrellas {
  readonly valor = input(0);
  readonly editable = input(false);
  readonly cambio = output<number>();
  readonly estrellas = [1, 2, 3, 4, 5];

  estaLlena(estrella: number): boolean {
    return estrella <= Math.round(this.valor());
  }

  elegir(estrella: number): void {
    if (this.editable()) this.cambio.emit(estrella);
  }
}
