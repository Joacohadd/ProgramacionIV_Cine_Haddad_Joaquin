import { Component, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { IScannerControls } from '@zxing/browser';
import { ModoLectura, RetiroCandyService } from '../../core/services/retiro-candy.service';

@Component({
  selector: 'app-validacion-personal',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './retiro-candy.html',
  styleUrl: './retiro-candy.css'
})
export class RetiroCandyComponent implements OnDestroy {
  @ViewChild('video') private video?: ElementRef<HTMLVideoElement>;

  readonly servicio = inject(RetiroCandyService);
  private readonly fb = inject(FormBuilder);
  private controles?: IScannerControls;
  private lecturaEnCurso = false;

  readonly modo = signal<ModoLectura>('qr');
  readonly escaneando = signal(false);
  readonly errorCamara = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    contenido: ['', Validators.required]
  });

  async consultar(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.detenerCamara();
    await this.servicio.consultar(this.form.controls.contenido.value, this.modo());
  }

  cambiarModo(modo: ModoLectura): void {
    this.detenerCamara();
    this.modo.set(modo);
    this.form.reset();
    this.servicio.limpiar();
    this.errorCamara.set(null);
  }

  async iniciarCamara(): Promise<void> {
    if (this.escaneando() || this.servicio.procesando()) return;
    this.errorCamara.set(null);
    this.escaneando.set(true);
    try {
      if (!this.video) throw new Error('No se encontró la vista de la cámara.');
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      this.controles = await new BrowserQRCodeReader().decodeFromVideoDevice(
        undefined,
        this.video.nativeElement,
        (resultado, _error, controles) => {
          if (!resultado || this.lecturaEnCurso || !this.escaneando()) return;
          this.lecturaEnCurso = true;
          controles.stop();
          this.controles = undefined;
          this.escaneando.set(false);
          this.form.controls.contenido.setValue(resultado.getText());
          void this.consultar().finally(() => { this.lecturaEnCurso = false; });
        }
      );
      if (!this.escaneando()) this.controles.stop();
    } catch {
      this.escaneando.set(false);
      this.errorCamara.set('No se pudo abrir la cámara. Permití su uso en el navegador o ingresá el código manualmente.');
    }
  }

  detenerCamara(): void {
    this.escaneando.set(false);
    this.controles?.stop();
    this.controles = undefined;
  }

  ngOnDestroy(): void {
    this.detenerCamara();
  }

  fecha(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(`${fecha}T00:00:00Z`));
  }

  fechaHora(fecha: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(fecha));
  }
}
