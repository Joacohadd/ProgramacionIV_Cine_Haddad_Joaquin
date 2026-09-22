-- RF-035: categorías del candy bar.
-- Ejecutar después de 20260919_productos_candy.sql.

create table if not exists public.categorias_candy (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 2 and 60)
);

create unique index if not exists categorias_candy_nombre_unico_idx
on public.categorias_candy (lower(trim(nombre)));

insert into public.categorias_candy (id, nombre) values
  ('c1000000-0000-4000-8000-000000000001', 'Pochoclos'),
  ('c1000000-0000-4000-8000-000000000002', 'Bebidas'),
  ('c1000000-0000-4000-8000-000000000003', 'Golosinas'),
  ('c1000000-0000-4000-8000-000000000004', 'Otros')
on conflict do nothing;

alter table public.productos_candy
add column if not exists categoria_id uuid
references public.categorias_candy(id) on delete restrict;

-- Conservamos los productos anteriores sin deducir su categoría por el nombre.
update public.productos_candy
set categoria_id = 'c1000000-0000-4000-8000-000000000004'
where categoria_id is null;

alter table public.productos_candy
alter column categoria_id set default 'c1000000-0000-4000-8000-000000000004';
alter table public.productos_candy alter column categoria_id set not null;

create index if not exists productos_candy_categoria_idx on public.productos_candy (categoria_id);

alter table public.categorias_candy enable row level security;

drop policy if exists "categorias: lectura publica" on public.categorias_candy;
create policy "categorias: lectura publica" on public.categorias_candy
for select to anon, authenticated using (true);

drop policy if exists "categorias: alta admin" on public.categorias_candy;
create policy "categorias: alta admin" on public.categorias_candy
for insert to authenticated with check (public.es_admin());

revoke all on public.categorias_candy from anon, authenticated;
grant select on public.categorias_candy to anon, authenticated;
grant insert on public.categorias_candy to authenticated;
