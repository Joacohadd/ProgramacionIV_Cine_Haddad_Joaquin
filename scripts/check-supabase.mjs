// Comprueba que la URL/key públicas sirven para consultar la vista requerida.
// No muestra la clave ni necesita una cuenta de administrador.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const source = readFileSync(new URL('../src/environments/environment.ts', import.meta.url), 'utf8');
const url = source.match(/url:\s*'([^']+)'/)?.[1];
const publicKey = source.match(/publicKey:\s*'([^']+)'/)?.[1];

if (!url || !publicKey) {
  console.error('Falta configurar URL o publishable key en environment.ts.');
  process.exit(1);
}

const supabase = createClient(url, publicKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const consultas = await Promise.all([
  supabase.from('peliculas').select('id').limit(1),
  supabase.from('peliculas_con_ventas').select('id,titulo').limit(1),
  supabase.from('resenas').select('id').limit(1),
  supabase.from('salas').select('id,nombre').limit(1),
  supabase.from('funciones').select('id').limit(1),
  supabase.from('funciones_detalle').select('id,pelicula_titulo,sala_nombre').limit(1),
  supabase.from('reservas_butacas').select('id,butaca_codigo,estado').limit(1),
  supabase.from('productos_candy').select('id,nombre,categoria_id,precio_centavos,activo').limit(1),
  supabase.from('categorias_candy').select('id,nombre').limit(1),
  supabase.from('combos_candy').select('id,nombre,precio_centavos,activo').limit(1)
]);

for (const [index, nombre] of ['peliculas', 'peliculas_con_ventas', 'resenas', 'salas', 'funciones', 'funciones_detalle', 'reservas_butacas', 'productos_candy', 'categorias_candy', 'combos_candy'].entries()) {
  const { data, error } = consultas[index];
  if (error) {
    console.error(`${nombre}: ${error.code ?? 'error'} — ${error.message}`);
    process.exitCode = 1;
  } else {
    console.log(`${nombre}: disponible${data?.length ? ' y con datos' : ', aún sin datos'}`);
  }
}
