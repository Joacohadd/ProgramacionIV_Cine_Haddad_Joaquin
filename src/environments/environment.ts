// Datos públicos del proyecto Supabase de Cine Umbral.
// Angular no interpreta NEXT_PUBLIC_* automáticamente: se configuran aquí.
// Jamás colocar la service_role key en el navegador.
export const environment = {
  production: false,
  supabase: {
    url: 'https://grpqxtitstasgonxhwky.supabase.co',
    publicKey: 'sb_publishable_5L0P4YPNC4UjRum-3kQ4jQ_9P0ztagP'
  }
};
