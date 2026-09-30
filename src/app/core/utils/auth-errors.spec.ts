import { describe, expect, it } from 'vitest';
import { mensajeErrorCredenciales } from './auth-errors';

describe('mensajes de credenciales', () => {
  it('traduce errores frecuentes y oculta el mensaje inglés inesperado', () => {
    expect(mensajeErrorCredenciales({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'ingresar'))
      .toBe('Correo o contraseña incorrectos.');
    expect(mensajeErrorCredenciales({ code: 'email_not_confirmed' }, 'ingresar'))
      .toContain('Confirmá tu correo');
    expect(mensajeErrorCredenciales({ message: 'Unexpected English backend error' }, 'registrar'))
      .toBe('No se pudo crear la cuenta. Revisá tus datos e intentá nuevamente.');
  });
});
