import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductoService } from '../../core/services/producto.service';
import { ProductoCard } from '../../shared/components/producto-card/producto-card';
import { RoleDirective } from '../../shared/directives/role.directive';

@Component({
  selector: 'app-candy',
  imports: [RouterLink, ProductoCard, RoleDirective],
  templateUrl: './candy.html',
  styleUrl: './candy.css'
})
export class Candy implements OnInit {
  readonly servicio = inject(ProductoService);

  ngOnInit(): void { void this.servicio.cargar(); }
}
