/** Mensajes de Supabase Auth que mostramos al usuario sin exponer texto en inglés. */
export function mensajeErrorCredenciales(error: { code?: string; message?: string }, accion: 'ingresar' | 'registrar'): string {
  const codigo = (error.code ?? '').toLowerCase();
  const mensaje = (error.message ?? '').toLowerCase();
  if (codigo === 'invalid_credentials' || mensaje.includes('invalid login credentials'))
    return 'Correo o contraseña incorrectos.';
  if (codigo === 'email_not_confirmed' || mensaje.includes('email not confirmed'))
    return 'Confirmá tu correo electrónico antes de ingresar.';
  if (codigo === 'user_already_exists' || mensaje.includes('already registered'))
    return 'Ese correo ya está registrado.';
  if (codigo === 'weak_password' || mensaje.includes('password should be') || mensaje.includes('password is too short'))
    return 'La contraseña es demasiado débil. Usá al menos 8 caracteres.';
  if (codigo === 'over_email_send_rate_limit' || codigo === 'over_request_rate_limit' || mensaje.includes('rate limit'))
    return 'Hay demasiados intentos. Esperá unos minutos y volvé a probar.';
  if (codigo === 'signup_disabled') return 'El registro de cuentas no está disponible por el momento.';
  if (codigo === 'email_address_invalid') return 'Ingresá un correo electrónico válido.';
  return accion === 'ingresar'
    ? 'No se pudo iniciar sesión. Revisá tus datos e intentá nuevamente.'
    : 'No se pudo crear la cuenta. Revisá tus datos e intentá nuevamente.';
}
