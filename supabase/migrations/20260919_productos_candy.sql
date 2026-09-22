-- RF-034: gestión y publicación de productos del candy bar.
-- Ejecutar en el SQL Editor de la base existente.

create table if not exists public.productos_candy (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 2 and 100),
  descripcion text not null check (length(trim(descripcion)) between 5 and 500),
  precio_centavos integer not null check (precio_centavos > 0),
  imagen_url text not null default ''
    check (imagen_url = '' or imagen_url ~ '^https://[^[:space:]]+$'),
  activo boolean not null default true
);

alter table public.productos_candy enable row level security;

drop policy if exists "productos: publicados o admin" on public.productos_candy;
create policy "productos: publicados o admin" on public.productos_candy
for select to anon, authenticated using (activo or public.es_admin());

drop policy if exists "productos: alta admin" on public.productos_candy;
create policy "productos: alta admin" on public.productos_candy
for insert to authenticated with check (public.es_admin());

drop policy if exists "productos: edicion admin" on public.productos_candy;
create policy "productos: edicion admin" on public.productos_candy
for update to authenticated
using (public.es_admin()) with check (public.es_admin());

-- La baja consiste en ocultar el producto: no se permite borrarlo directamente.
revoke all on public.productos_candy from anon, authenticated;
grant select on public.productos_candy to anon, authenticated;
grant insert, update on public.productos_candy to authenticated;
