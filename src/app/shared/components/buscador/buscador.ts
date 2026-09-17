import { Component, model } from '@angular/core';

@Component({ selector: 'app-buscador', templateUrl: './buscador.html', styleUrl: './buscador.css' })
export class Buscador {
  readonly termino = model('');
  limpiar(): void { this.termino.set(''); }
}
