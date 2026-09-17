-- Migración para sumar el punto 4.4 a una base que ya ejecutó las etapas anteriores.
-- Incluye salas, programación recurrente, asignación automática y control de cruces.

create table if not exists public.salas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (length(trim(nombre)) between 2 and 80),
  filas integer not null default 20 check (filas between 1 and 40),
  butacas_izquierda integer not null default 4 check (butacas_izquierda between 1 and 50),
  butacas_centro integer not null default 20 check (butacas_centro between 1 and 50),
  butacas_derecha integer not null default 4 check (butacas_derecha between 1 and 50),
  formatos text[] not null default array['2D']::text[]
    check (cardinality(formatos) >= 1 and formatos <@ array['2D','3D','4D','5D']::text[]),
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.funciones (
  id uuid primary key default gen_random_uuid(),
  pelicula_id uuid not null references public.peliculas(id) on delete cascade,
  sala_id uuid not null references public.salas(id),
  fecha_desde date not null,
  fecha_hasta date not null check (fecha_hasta >= fecha_desde),
  dias_semana smallint[] not null
    check (cardinality(dias_semana) >= 1 and dias_semana <@ array[1,2,3,4,5,6,7]::smallint[]),
  hora_inicio time not null,
  formato text not null check (formato in ('2D','3D','4D','5D')),
  idioma text not null check (idioma in ('Castellano','Subtitulada')),
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists funciones_sala_fechas_idx on public.funciones (sala_id, fecha_desde, fecha_hasta);
create index if not exists funciones_pelicula_idx on public.funciones (pelicula_id);

create or replace function public.horarios_se_superponen(
  dias_a smallint[], hora_a time, duracion_a integer,
  dias_b smallint[], hora_b time, duracion_b integer
)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select exists (
    select 1
    from unnest(dias_a) as a(dia)
    cross join unnest(dias_b) as b(dia)
    cross join (values (-10080), (0), (10080)) as s(desplazamiento)
    where
      (((a.dia - 1) * 1440) + extract(epoch from hora_a)::integer / 60)
        < (((b.dia - 1) * 1440) + extract(epoch from hora_b)::integer / 60 + s.desplazamiento + duracion_b + 30)
      and (((b.dia - 1) * 1440) + extract(epoch from hora_b)::integer / 60 + s.desplazamiento)
        < (((a.dia - 1) * 1440) + extract(epoch from hora_a)::integer / 60 + duracion_a + 30)
  );
$$;

create or replace function public.asignar_sala_funcion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  duracion_nueva integer;
  sala_elegida uuid;
  sala_preferida uuid;
begin
  perform pg_advisory_xact_lock(hashtext('umbral_asignacion_salas'));
  select duracion_minutos into duracion_nueva from public.peliculas where id = new.pelicula_id;
  if duracion_nueva is null then
    raise exception 'La película seleccionada no existe.';
  end if;

  if tg_op = 'UPDATE' then sala_preferida := old.sala_id;
  else sala_preferida := new.sala_id;
  end if;

  select s.id into sala_elegida
  from public.salas s
  where s.activa
    and new.formato = any(s.formatos)
    and not exists (
      select 1
      from public.funciones f
      join public.peliculas p_existente on p_existente.id = f.pelicula_id
      where f.sala_id = s.id
        and f.id <> new.id
        and f.activa and new.activa
        and f.fecha_desde <= new.fecha_hasta
        and new.fecha_desde <= f.fecha_hasta
        and public.horarios_se_superponen(
          new.dias_semana, new.hora_inicio, duracion_nueva,
          f.dias_semana, f.hora_inicio, p_existente.duracion_minutos
        )
    )
  order by case when s.id = sala_preferida then 0 else 1 end, s.nombre
  limit 1;

  if sala_elegida is null then
    raise exception 'No hay una sala compatible y libre para esos días y horario.';
  end if;
  new.sala_id := sala_elegida;
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists antes_de_guardar_funcion on public.funciones;
create trigger antes_de_guardar_funcion before insert or update on public.funciones
for each row execute function public.asignar_sala_funcion();

create or replace function public.validar_sala_programada()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.funciones f
    where f.sala_id = new.id and f.activa
      and (not new.activa or not (f.formato = any(new.formatos)))
  ) then
    raise exception 'La sala tiene funciones activas incompatibles con este cambio.';
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists antes_de_actualizar_sala on public.salas;
create trigger antes_de_actualizar_sala before update on public.salas
for each row execute function public.validar_sala_programada();

create or replace function public.validar_duracion_programada()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.duracion_minutos <> old.duracion_minutos and exists (
    select 1
    from public.funciones propia
    join public.funciones otra on otra.sala_id = propia.sala_id and otra.id <> propia.id
    join public.peliculas pelicula_otra on pelicula_otra.id = otra.pelicula_id
    where propia.pelicula_id = new.id and propia.activa and otra.activa
      and propia.fecha_desde <= otra.fecha_hasta and otra.fecha_desde <= propia.fecha_hasta
      and public.horarios_se_superponen(
        propia.dias_semana, propia.hora_inicio, new.duracion_minutos,
        otra.dias_semana, otra.hora_inicio, pelicula_otra.duracion_minutos
      )
  ) then
    raise exception 'La nueva duración se superpone con otra función de la sala.';
  end if;
  return new;
end;
$$;

drop trigger if exists antes_de_cambiar_duracion on public.peliculas;
create trigger antes_de_cambiar_duracion before update of duracion_minutos on public.peliculas
for each row execute function public.validar_duracion_programada();

alter table public.salas enable row level security;
alter table public.funciones enable row level security;

drop policy if exists "salas: activas o admin" on public.salas;
create policy "salas: activas o admin" on public.salas for select
to anon, authenticated using (activa or public.es_admin());
drop policy if exists "salas: alta admin" on public.salas;
create policy "salas: alta admin" on public.salas for insert
to authenticated with check (public.es_admin());
drop policy if exists "salas: edicion admin" on public.salas;
create policy "salas: edicion admin" on public.salas for update
to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists "salas: baja admin" on public.salas;
create policy "salas: baja admin" on public.salas for delete
to authenticated using (public.es_admin());

drop policy if exists "funciones: públicas o admin" on public.funciones;
create policy "funciones: públicas o admin" on public.funciones for select
to anon, authenticated using (
  public.es_admin() or (
    activa and exists (select 1 from public.peliculas p where p.id = pelicula_id and p.visible_inicio)
  )
);
drop policy if exists "funciones: alta admin" on public.funciones;
create policy "funciones: alta admin" on public.funciones for insert
to authenticated with check (public.es_admin());
drop policy if exists "funciones: edicion admin" on public.funciones;
create policy "funciones: edicion admin" on public.funciones for update
to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists "funciones: baja admin" on public.funciones;
create policy "funciones: baja admin" on public.funciones for delete
to authenticated using (public.es_admin());

create or replace view public.funciones_detalle as
select f.id, f.pelicula_id, f.sala_id, f.fecha_desde, f.fecha_hasta,
       f.dias_semana, f.hora_inicio, f.formato, f.idioma, f.activa,
       p.titulo as pelicula_titulo, p.imagen_url as pelicula_imagen_url,
       p.duracion_minutos, s.nombre as sala_nombre
from public.funciones f
join public.peliculas p on p.id = f.pelicula_id
join public.salas s on s.id = f.sala_id
where public.es_admin() or (f.activa and p.visible_inicio and s.activa);

grant select on public.salas, public.funciones, public.funciones_detalle to anon, authenticated;
grant insert, update, delete on public.salas, public.funciones to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'salas'
  ) then alter publication supabase_realtime add table public.salas;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'funciones'
  ) then alter publication supabase_realtime add table public.funciones;
  end if;
end;
$$;
