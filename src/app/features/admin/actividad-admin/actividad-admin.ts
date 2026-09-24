import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActividadCine } from '../../../core/models/auditoria.interface';
import { AdministracionPersonalService } from '../../../core/services/administracion-personal.service';

@Component({
  selector: 'app-actividad-admin',
  imports: [RouterLink],
  templateUrl: './actividad-admin.html',
  styleUrl: './actividad-admin.css'
})
export class ActividadAdmin implements OnInit {
  readonly servicio = inject(AdministracionPersonalService);
  readonly busqueda = signal('');
  readonly cuentasFiltradas = computed(() => this.servicio.cuentas().filter(cuenta =>
    `${cuenta.nombre} ${cuenta.apellido} ${cuenta.email}`
      .toLocaleLowerCase().includes(this.busqueda().trim().toLocaleLowerCase())));

  ngOnInit(): void {
    void this.servicio.cargar();
  }

  fechaHora(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(fecha));
  }

  accion(registro: ActividadCine): string {
    const nombres: Record<string, string> = {
      funcion_creada: 'Función creada',
      funcion_modificada: 'Función modificada',
      funcion_eliminada: 'Función eliminada',
      precio_preventa_modificado: 'Precio de preventa modificado',
      precio_modificado: 'Precio modificado',
      ingreso_validado: 'Ingreso validado',
      candy_entregado: 'Candy entregado',
      rol_modificado: 'Rol de usuario modificado'
    };
    return nombres[registro.accion] ?? registro.accion;
  }

  detalle(registro: ActividadCine): string {
    const valor = registro.detalle;
    const referencia = valor['codigo'] ?? valor['titulo'] ?? valor['nombre'] ?? valor['email'];
    if (typeof referencia === 'string') {
      const medio = valor['medio'];
      return medio === 'qr' || medio === 'manual'
        ? `${referencia} · ${medio === 'qr' ? 'QR' : 'código manual'}`
        : referencia;
    }
    return registro.entidad_id ?? '—';
  }
}
