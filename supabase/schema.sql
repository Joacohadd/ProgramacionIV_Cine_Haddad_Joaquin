-- Esquema completo de Umbral Cine hasta el punto 4.4.
-- Ejecutar una vez en el SQL Editor de un proyecto Supabase nuevo.

create extension if not exists pgcrypto;

-- ============================================================
-- USUARIOS Y PERFILES
-- ============================================================
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text not null check (length(trim(nombre)) between 2 and 80),
  apellido text not null check (length(trim(apellido)) between 2 and 80),
  fecha_nacimiento date not null check (fecha_nacimiento <= current_date),
  tipo_sangre text not null check (tipo_sangre in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  color_ojos text not null check (color_ojos in ('Marrón','Negro','Verde','Azul','Gris','Avellana','Otro')),
  dias_vacaciones integer not null check (dias_vacaciones between 0 and 365),
  rol text not null default 'cliente' check (rol in ('cliente','admin','empleado')),
  puntos integer not null default 0 check (puntos >= 0),
  credito_centavos bigint not null default 0 check (credito_centavos >= 0),
  creado_en timestamptz not null default now()
);

create or replace function public.crear_perfil_usuario()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.perfiles (
    id, email, nombre, apellido, fecha_nacimiento, tipo_sangre, color_ojos, dias_vacaciones
  ) values (
    new.id, new.email, new.raw_user_meta_data->>'nombre', new.raw_user_meta_data->>'apellido',
    (new.raw_user_meta_data->>'fecha_nacimiento')::date, new.raw_user_meta_data->>'tipo_sangre',
    new.raw_user_meta_data->>'color_ojos', (new.raw_user_meta_data->>'dias_vacaciones')::integer
  );
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
for each row execute function public.crear_perfil_usuario();

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

-- ============================================================
-- PELÍCULAS, RESEÑAS Y FUENTE DE VENTAS
-- ============================================================
create table if not exists public.peliculas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) between 2 and 120),
  sinopsis text not null check (length(trim(sinopsis)) between 15 and 1200),
  duracion_minutos integer not null check (duracion_minutos between 1 and 600),
  imagen_url text not null check (imagen_url ~ '^(https://|/posters/).+'),
  generos text[] not null check (cardinality(generos) >= 1),
  clasificacion text not null default 'ATP' check (clasificacion in ('ATP','13','18')),
  visible_inicio boolean not null default false,
  fecha_estreno date not null,
  actualizado_en timestamptz not null default now()
);

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

-- La compra se implementa más adelante. Esta tabla mínima permite que el top 3
-- cuente únicamente entradas cuyo estado sea pagada.
create table if not exists public.entradas (
  id uuid primary key default gen_random_uuid(),
  pelicula_id uuid not null references public.peliculas(id),
  estado text not null check (estado in ('pendiente','pagada','cancelada')),
  creada_en timestamptz not null default now()
);

-- ============================================================
-- SALAS Y PROGRAMACIÓN RECURRENTE
-- ============================================================
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

-- Compara intervalos semanales. Cada función ocupa su duración más los 30
-- minutos obligatorios, incluso si termina al día siguiente.
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

-- La asignación se serializa para que dos altas simultáneas no puedan elegir
-- la misma sala. En edición intenta conservar la sala anterior si sigue libre.
create or replace function public.asignar_sala_funcion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  duracion_nueva integer;
  sala_elegida uuid;
  sala_preferida uuid;
begin
  perform pg_advisory_xact_lock(hashtext('umbral_asignacion_salas'));
  select duracion_minutos into duracion_nueva from public.peliculas where id = new.pelicula_id;
  if duracion_nueva is null then raise exception 'La película seleccionada no existe.'; end if;
  if tg_op = 'UPDATE' then sala_preferida := old.sala_id; else sala_preferida := new.sala_id; end if;

  select s.id into sala_elegida
  from public.salas s
  where s.activa and new.formato = any(s.formatos)
    and not exists (
      select 1
      from public.funciones f
      join public.peliculas p_existente on p_existente.id = f.pelicula_id
      where f.sala_id = s.id and f.id <> new.id and f.activa and new.activa
        and f.fecha_desde <= new.fecha_hasta and new.fecha_desde <= f.fecha_hasta
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

-- Impide desactivar una sala o quitarle un formato todavía usado.
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

-- Editar la duración de una película tampoco puede generar una superposición.
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

-- ============================================================
-- SEGURIDAD POR FILA
-- ============================================================
alter table public.perfiles enable row level security;
alter table public.peliculas enable row level security;
alter table public.resenas enable row level security;
alter table public.entradas enable row level security;
alter table public.salas enable row level security;
alter table public.funciones enable row level security;

drop policy if exists "perfiles: propio o admin" on public.perfiles;
create policy "perfiles: propio o admin" on public.perfiles for select to authenticated
using (id = auth.uid() or public.es_admin());

drop policy if exists "peliculas: cartelera visible o admin" on public.peliculas;
create policy "peliculas: cartelera visible o admin" on public.peliculas for select
to anon, authenticated using (visible_inicio or public.es_admin());
drop policy if exists "peliculas: alta admin" on public.peliculas;
create policy "peliculas: alta admin" on public.peliculas for insert
to authenticated with check (public.es_admin());
drop policy if exists "peliculas: edicion admin" on public.peliculas;
create policy "peliculas: edicion admin" on public.peliculas for update
to authenticated using (public.es_admin()) with check (public.es_admin());

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

-- No existen políticas públicas de entradas hasta implementar el checkout.

-- ============================================================
-- VISTAS DE LECTURA
-- ============================================================
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
  from public.resenas rn where rn.pelicula_id = p.id
) r on true
where p.visible_inicio or public.es_admin();

create or replace view public.funciones_detalle as
select f.id, f.pelicula_id, f.sala_id, f.fecha_desde, f.fecha_hasta,
       f.dias_semana, f.hora_inicio, f.formato, f.idioma, f.activa,
       p.titulo as pelicula_titulo, p.imagen_url as pelicula_imagen_url,
       p.duracion_minutos, s.nombre as sala_nombre
from public.funciones f
join public.peliculas p on p.id = f.pelicula_id
join public.salas s on s.id = f.sala_id
where public.es_admin() or (f.activa and p.visible_inicio and s.activa);

grant select on public.peliculas_con_ventas, public.funciones_detalle to anon, authenticated;
grant select on public.peliculas, public.resenas, public.salas, public.funciones to anon, authenticated;
grant select on public.perfiles to authenticated;
grant insert, update on public.peliculas to authenticated;
grant insert, update, delete on public.resenas, public.salas, public.funciones to authenticated;
revoke all on public.entradas from anon, authenticated;

-- ============================================================
-- ACTUALIZACIÓN EN TIEMPO REAL
-- ============================================================
create or replace function public.notificar_cambio_ventas()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.peliculas set actualizado_en = now()
  where id = coalesce(new.pelicula_id, old.pelicula_id);
  return coalesce(new, old);
end;
$$;
drop trigger if exists al_cambiar_entrada on public.entradas;
create trigger al_cambiar_entrada after insert or update or delete on public.entradas
for each row execute function public.notificar_cambio_ventas();

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
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'peliculas')
  then alter publication supabase_realtime add table public.peliculas; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'resenas')
  then alter publication supabase_realtime add table public.resenas; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'salas')
  then alter publication supabase_realtime add table public.salas; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'funciones')
  then alter publication supabase_realtime add table public.funciones; end if;
end;
$$;
