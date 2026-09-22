import { Component, input, signal } from '@angular/core';
import { Producto } from '../../../core/models/producto.interface';

@Component({
  selector: 'app-producto-card',
  templateUrl: './producto-card.html',
  styleUrl: './producto-card.css'
})
export class ProductoCard {
  readonly producto = input.required<Producto>();
  readonly categoria = input('Candy bar');
  readonly imagenFallida = signal<string | null>(null);

  precio(centavos: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(centavos / 100);
  }
}
