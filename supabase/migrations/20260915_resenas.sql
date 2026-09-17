-- Migración para sumar el punto 4.3 a una base que ya ejecutó schema.sql.
-- Puede ejecutarse más de una vez desde el SQL Editor.

create table if not exists public.resenas (
  id uuid primary key default gen_random_uuid(),
  pelicula_id uuid not null references public.peliculas(id) on delete cascade,
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  autor_nombre text not null check (length(trim(autor_nombre)) between 2 and 120),
  estrellas smallint not null check (estrellas between 1 and 5),
  comentario text not null check (length(trim(comentario)) between 5 and 280),
  creado_en timestamptz not null default now(),
  unique (pelicula_id, usuario_id)
);
create index if not exists resenas_pelicula_creado_idx on public.resenas (pelicula_id, creado_en desc);

alter table public.resenas enable row level security;

drop policy if exists "resenas: lectura pública" on public.resenas;
create policy "resenas: lectura pública" on public.resenas for select
to anon, authenticated using (true);
drop policy if exists "resenas: crear propia" on public.resenas;
create policy "resenas: crear propia" on public.resenas for insert
to authenticated with check (usuario_id = auth.uid());
drop policy if exists "resenas: editar propia" on public.resenas;
create policy "resenas: editar propia" on public.resenas for update
to authenticated using (usuario_id = auth.uid() or public.es_admin())
with check (usuario_id = auth.uid() or public.es_admin());
drop policy if exists "resenas: borrar propia" on public.resenas;
create policy "resenas: borrar propia" on public.resenas for delete
to authenticated using (usuario_id = auth.uid() or public.es_admin());

create or replace view public.peliculas_con_ventas as
select p.id, p.titulo, p.sinopsis, p.duracion_minutos, p.imagen_url,
       p.generos, p.clasificacion, p.visible_inicio, p.fecha_estreno,
       coalesce(v.total, 0)::integer as entradas_vendidas,
       coalesce(r.promedio, 0)::numeric(3,1) as promedio_calificacion,
       coalesce(r.cantidad, 0)::integer as cantidad_resenas
from public.peliculas p
left join lateral (
  select count(*) as total from public.entradas e
  where e.pelicula_id = p.id and e.estado = 'pagada'
) v on true
left join lateral (
  select round(avg(rn.estrellas)::numeric, 1) as promedio, count(*) as cantidad
  from public.resenas rn
  where rn.pelicula_id = p.id
) r on true
where p.visible_inicio or public.es_admin();

grant select on public.peliculas_con_ventas to anon, authenticated;
grant select on public.resenas to anon, authenticated;
grant insert, update, delete on public.resenas to authenticated;

create or replace function public.notificar_cambio_resena()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.peliculas set actualizado_en = now()
  where id = coalesce(new.pelicula_id, old.pelicula_id);
  return coalesce(new, old);
end;
$$;
drop trigger if exists al_cambiar_resena on public.resenas;
create trigger al_cambiar_resena after insert or update or delete on public.resenas
for each row execute function public.notificar_cambio_resena();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'peliculas'
  ) then
    alter publication supabase_realtime add table public.peliculas;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'resenas'
  ) then
    alter publication supabase_realtime add table public.resenas;
  end if;
end;
$$;
