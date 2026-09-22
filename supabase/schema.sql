-- Esquema completo de Umbral Cine hasta 4.6 y RF-034/RF-035 del punto 4.7.
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

-- Las columnas propias de la compra se agregan luego de declarar funciones y salas.
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

-- ============================================================
-- BUTACAS Y RESERVAS TEMPORALES
-- ============================================================
create table if not exists public.reservas_butacas (
  id uuid primary key default gen_random_uuid(),
  funcion_id uuid not null references public.funciones(id) on delete cascade,
  fecha_funcion date not null,
  butaca_codigo text not null check (butaca_codigo ~ '^[A-Z]-[0-9]{2,3}$'),
  tipo text not null check (tipo in ('estandar','accesible','vip')),
  estado text not null default 'reservada' check (estado in ('reservada','ocupada')),
  sesion_hash text not null,
  precio_centavos integer not null check (precio_centavos >= 0),
  expira_en timestamptz,
  creada_en timestamptz not null default now(),
  unique (funcion_id, fecha_funcion, butaca_codigo),
  check ((estado = 'reservada' and expira_en is not null) or estado = 'ocupada')
);

create index if not exists reservas_butacas_funcion_fecha_idx
on public.reservas_butacas (funcion_id, fecha_funcion);
create index if not exists reservas_butacas_expiracion_idx
on public.reservas_butacas (expira_en) where estado = 'reservada';

create or replace function public.sincronizar_reserva_butacas(
  p_funcion_id uuid,
  p_fecha date,
  p_codigos text[],
  p_sesion_token uuid
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_sala public.salas%rowtype;
  v_funcion public.funciones%rowtype;
  v_hash text;
  v_codigo text;
  v_fila text;
  v_numero integer;
  v_fila_numero integer;
  v_maximo integer;
  v_tipo text;
  v_precio integer;
begin
  if p_sesion_token is null then raise exception 'La sesión de selección no es válida.'; end if;
  p_codigos := coalesce(p_codigos, array[]::text[]);
  if cardinality(p_codigos) <> (select count(distinct codigo) from unnest(p_codigos) as codigo) then
    raise exception 'La selección contiene butacas repetidas.';
  end if;

  select f.* into v_funcion from public.funciones f where f.id = p_funcion_id and f.activa;
  if not found then raise exception 'La función seleccionada no está disponible.'; end if;
  if p_fecha < v_funcion.fecha_desde or p_fecha > v_funcion.fecha_hasta
     or not (extract(isodow from p_fecha)::smallint = any(v_funcion.dias_semana)) then
    raise exception 'La fecha no corresponde a la programación seleccionada.';
  end if;

  select s.* into v_sala from public.salas s where s.id = v_funcion.sala_id and s.activa;
  if not found then raise exception 'La sala no está disponible.'; end if;

  delete from public.reservas_butacas where estado = 'reservada' and expira_en <= now();
  v_hash := encode(digest(p_sesion_token::text, 'sha256'), 'hex');
  delete from public.reservas_butacas
  where funcion_id = p_funcion_id and fecha_funcion = p_fecha
    and sesion_hash = v_hash and estado = 'reservada';

  foreach v_codigo in array p_codigos loop
    if v_codigo !~ '^[A-Z]-[0-9]{2,3}$' then raise exception 'El código de butaca % no es válido.', v_codigo; end if;
    v_fila := split_part(v_codigo, '-', 1);
    v_numero := split_part(v_codigo, '-', 2)::integer;
    v_fila_numero := ascii(v_fila) - 64;
    if v_fila_numero < 1 or v_fila_numero > v_sala.filas then raise exception 'La fila % no existe en esta sala.', v_fila; end if;

    if v_fila in ('J', 'K') then
      v_tipo := 'accesible'; v_maximo := 14;
    elsif v_fila in ('R', 'S', 'T') then
      v_tipo := 'vip'; v_maximo := v_sala.butacas_izquierda + v_sala.butacas_centro + v_sala.butacas_derecha;
    else
      v_tipo := 'estandar'; v_maximo := v_sala.butacas_izquierda + v_sala.butacas_centro + v_sala.butacas_derecha;
    end if;
    if v_numero < 1 or v_numero > v_maximo then raise exception 'La butaca % no existe en esta sala.', v_codigo; end if;

    v_precio := 800000 + case when v_tipo = 'vip' then 300000 else 0 end;
    insert into public.reservas_butacas (
      funcion_id, fecha_funcion, butaca_codigo, tipo, estado, sesion_hash, precio_centavos, expira_en
    ) values (
      p_funcion_id, p_fecha, v_codigo, v_tipo, 'reservada', v_hash, v_precio, now() + interval '8 minutes'
    );
  end loop;
  return cardinality(p_codigos);
exception
  when unique_violation then
    raise exception 'Una de las butacas ya fue ocupada o reservada por otra persona.' using errcode = '23505';
end;
$$;

alter table public.reservas_butacas enable row level security;
drop policy if exists "butacas: disponibilidad pública" on public.reservas_butacas;
create policy "butacas: disponibilidad pública" on public.reservas_butacas
for select to anon, authenticated using (estado = 'ocupada' or expira_en > now());

revoke all on public.reservas_butacas from anon, authenticated;
grant select on public.reservas_butacas to anon, authenticated;
revoke all on function public.sincronizar_reserva_butacas(uuid, date, text[], uuid) from public;
grant execute on function public.sincronizar_reserva_butacas(uuid, date, text[], uuid) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservas_butacas'
  ) then alter publication supabase_realtime add table public.reservas_butacas;
  end if;
end;
$$;

-- ============================================================
-- COMPRAS, ENTRADAS, QR Y CANCELACIONES
-- ============================================================
create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^UMB-[A-Z0-9]{10}$'),
  usuario_id uuid references public.perfiles(id) on delete restrict,
  comprador_email text not null check (comprador_email = lower(trim(comprador_email))),
  funcion_id uuid not null references public.funciones(id) on delete restrict,
  fecha_funcion date not null,
  total_centavos bigint not null check (total_centavos > 0),
  credito_usado_centavos bigint not null default 0 check (credito_usado_centavos >= 0),
  pago_otro_centavos bigint not null default 0 check (pago_otro_centavos >= 0),
  medio_pago text not null check (medio_pago in ('tarjeta_credito','tarjeta_debito','billetera_virtual','credito')),
  estado text not null default 'pagada' check (estado in ('pagada','cancelada')),
  qr_token uuid not null default gen_random_uuid() unique,
  aviso_adulto boolean not null default false,
  creada_en timestamptz not null default now(),
  cancelada_en timestamptz,
  check (total_centavos = credito_usado_centavos + pago_otro_centavos),
  check ((estado = 'cancelada' and cancelada_en is not null) or (estado = 'pagada' and cancelada_en is null))
);

create index if not exists compras_usuario_fecha_idx on public.compras (usuario_id, creada_en desc);
create index if not exists compras_funcion_fecha_idx on public.compras (funcion_id, fecha_funcion);

alter table public.entradas add column if not exists compra_id uuid;
alter table public.entradas add column if not exists funcion_id uuid;
alter table public.entradas add column if not exists fecha_funcion date;
alter table public.entradas add column if not exists butaca_codigo text;
alter table public.entradas add column if not exists tipo text;
alter table public.entradas add column if not exists precio_centavos integer;
alter table public.entradas add column if not exists aviso_adulto boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'entradas_compra_id_fkey' and conrelid = 'public.entradas'::regclass) then
    alter table public.entradas add constraint entradas_compra_id_fkey
      foreign key (compra_id) references public.compras(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entradas_funcion_id_fkey' and conrelid = 'public.entradas'::regclass) then
    alter table public.entradas add constraint entradas_funcion_id_fkey
      foreign key (funcion_id) references public.funciones(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entradas_butaca_codigo_check' and conrelid = 'public.entradas'::regclass) then
    alter table public.entradas add constraint entradas_butaca_codigo_check
      check (butaca_codigo is null or butaca_codigo ~ '^[A-Z]-[0-9]{2,3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entradas_tipo_check' and conrelid = 'public.entradas'::regclass) then
    alter table public.entradas add constraint entradas_tipo_check
      check (tipo is null or tipo in ('estandar','accesible','vip'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entradas_precio_centavos_check' and conrelid = 'public.entradas'::regclass) then
    alter table public.entradas add constraint entradas_precio_centavos_check
      check (precio_centavos is null or precio_centavos >= 0);
  end if;
end;
$$;

create unique index if not exists entradas_butaca_pagada_unica_idx
on public.entradas (funcion_id, fecha_funcion, butaca_codigo)
where estado = 'pagada' and funcion_id is not null and fecha_funcion is not null and butaca_codigo is not null;
create index if not exists entradas_compra_idx on public.entradas (compra_id);

create or replace function public.confirmar_compra(
  p_funcion_id uuid, p_fecha date, p_codigos text[], p_sesion_token uuid,
  p_email text, p_fecha_nacimiento date, p_usar_credito boolean, p_medio_pago text
)
returns table (
  compra_id uuid, compra_codigo text, compra_qr_token uuid,
  total_centavos bigint, credito_usado_centavos bigint, pago_otro_centavos bigint,
  medio_pago text, aviso_adulto boolean, comprador_email text, creada_en timestamptz
)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_funcion public.funciones%rowtype;
  v_pelicula public.peliculas%rowtype;
  v_perfil public.perfiles%rowtype;
  v_compra public.compras%rowtype;
  v_usuario uuid := auth.uid();
  v_hash text;
  v_email text;
  v_nacimiento date;
  v_edad integer;
  v_edad_minima integer;
  v_cantidad integer;
  v_total bigint;
  v_credito bigint := 0;
  v_otro bigint;
  v_medio text;
begin
  if p_sesion_token is null then raise exception 'La sesión de reserva no es válida.'; end if;
  p_codigos := coalesce(p_codigos, array[]::text[]);
  if cardinality(p_codigos) = 0 then raise exception 'Elegí al menos una butaca.'; end if;
  if cardinality(p_codigos) <> (select count(distinct codigo) from unnest(p_codigos) as codigo) then
    raise exception 'La compra contiene butacas repetidas.';
  end if;

  select f.* into v_funcion from public.funciones f where f.id = p_funcion_id and f.activa;
  if not found then raise exception 'La función seleccionada no está disponible.'; end if;
  if p_fecha < v_funcion.fecha_desde or p_fecha > v_funcion.fecha_hasta
     or not (extract(isodow from p_fecha)::smallint = any(v_funcion.dias_semana)) then
    raise exception 'La fecha no corresponde a la programación seleccionada.';
  end if;
  if ((p_fecha + v_funcion.hora_inicio) at time zone 'America/Argentina/Buenos_Aires') <= now() then
    raise exception 'La función ya comenzó.';
  end if;

  select p.* into v_pelicula from public.peliculas p where p.id = v_funcion.pelicula_id;
  if not found then raise exception 'La película no está disponible.'; end if;
  if v_usuario is not null then
    select p.* into v_perfil from public.perfiles p where p.id = v_usuario for update;
    if not found then raise exception 'No se encontró el perfil de la cuenta.'; end if;
    v_email := lower(trim(v_perfil.email));
    v_nacimiento := v_perfil.fecha_nacimiento;
  else
    v_email := lower(trim(coalesce(p_email, '')));
    v_nacimiento := p_fecha_nacimiento;
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Ingresá un correo electrónico válido.'; end if;
    if v_nacimiento is null or v_nacimiento > current_date then raise exception 'Ingresá una fecha de nacimiento válida.'; end if;
  end if;

  v_edad := extract(year from age(p_fecha, v_nacimiento));
  v_edad_minima := case v_pelicula.clasificacion when '13' then 13 when '18' then 18 else 0 end;
  if v_edad < v_edad_minima then
    raise exception 'La clasificación % requiere tener al menos % años en la fecha de la función.', v_pelicula.clasificacion, v_edad_minima;
  end if;

  delete from public.reservas_butacas where estado = 'reservada' and expira_en <= now();
  v_hash := encode(digest(p_sesion_token::text, 'sha256'), 'hex');
  perform 1 from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada' and r.expira_en > now() for update;
  select count(*), coalesce(sum(r.precio_centavos), 0) into v_cantidad, v_total
  from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada' and r.expira_en > now();
  if v_cantidad <> cardinality(p_codigos) then raise exception 'La reserva venció o una de las butacas ya no está disponible.'; end if;

  if coalesce(p_usar_credito, false) and v_usuario is not null then v_credito := least(v_perfil.credito_centavos, v_total); end if;
  v_otro := v_total - v_credito;
  if v_otro = 0 then
    v_medio := 'credito';
  else
    if p_medio_pago is null or p_medio_pago not in ('tarjeta_credito','tarjeta_debito','billetera_virtual') then raise exception 'Elegí un medio de pago válido.'; end if;
    v_medio := p_medio_pago;
  end if;
  if v_credito > 0 then update public.perfiles set credito_centavos = credito_centavos - v_credito where id = v_usuario; end if;

  insert into public.compras (
    codigo, usuario_id, comprador_email, funcion_id, fecha_funcion,
    total_centavos, credito_usado_centavos, pago_otro_centavos, medio_pago, aviso_adulto
  ) values (
    'UMB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_usuario, v_email, p_funcion_id, p_fecha,
    v_total, v_credito, v_otro, v_medio, v_pelicula.clasificacion <> 'ATP'
  ) returning * into v_compra;

  insert into public.entradas (
    compra_id, pelicula_id, funcion_id, fecha_funcion, butaca_codigo,
    tipo, precio_centavos, aviso_adulto, estado
  )
  select v_compra.id, v_funcion.pelicula_id, p_funcion_id, p_fecha,
         r.butaca_codigo, r.tipo, r.precio_centavos,
         v_pelicula.clasificacion <> 'ATP', 'pagada'
  from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash and r.estado = 'reservada';
  update public.reservas_butacas r set estado = 'ocupada', expira_en = null
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash and r.estado = 'reservada';
  return query select v_compra.id, v_compra.codigo, v_compra.qr_token,
    v_compra.total_centavos, v_compra.credito_usado_centavos, v_compra.pago_otro_centavos,
    v_compra.medio_pago, v_compra.aviso_adulto, v_compra.comprador_email, v_compra.creada_en;
exception when unique_violation then
  raise exception 'Una de las butacas ya fue vendida. Volvé al mapa y elegí otra ubicación.' using errcode = '23505';
end;
$$;

create or replace function public.cancelar_compra(p_compra_id uuid)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compra public.compras%rowtype;
  v_hora time;
  v_credito bigint;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para cancelar una compra.'; end if;
  select c.* into v_compra from public.compras c where c.id = p_compra_id for update;
  if not found or v_compra.usuario_id is distinct from auth.uid() then raise exception 'La compra no pertenece a tu cuenta.'; end if;
  if v_compra.estado <> 'pagada' then raise exception 'La compra ya está cancelada.'; end if;
  select f.hora_inicio into v_hora from public.funciones f where f.id = v_compra.funcion_id;
  if ((v_compra.fecha_funcion + v_hora) at time zone 'America/Argentina/Buenos_Aires') < now() + interval '2 hours' then
    raise exception 'La cancelación solo está disponible hasta 2 horas antes de la función.';
  end if;
  update public.perfiles set credito_centavos = credito_centavos + v_compra.total_centavos
  where id = auth.uid() returning credito_centavos into v_credito;
  delete from public.reservas_butacas r using public.entradas e
  where e.compra_id = v_compra.id and e.estado = 'pagada'
    and r.funcion_id = e.funcion_id and r.fecha_funcion = e.fecha_funcion
    and r.butaca_codigo = e.butaca_codigo and r.estado = 'ocupada';
  update public.entradas set estado = 'cancelada' where compra_id = v_compra.id and estado = 'pagada';
  update public.compras set estado = 'cancelada', cancelada_en = now() where id = v_compra.id;
  return v_credito;
end;
$$;

-- El QR contiene UMBRAL|código|token. El personal usa ambos valores
-- para consultar el estado y los datos de la entrada sin exponer compras ajenas.
create or replace function public.validar_entrada_qr(p_codigo text, p_qr_token uuid)
returns table (
  valida boolean,
  estado text,
  pelicula_titulo text,
  fecha_funcion date,
  hora_inicio time,
  sala_nombre text,
  butacas text[]
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol in ('empleado','admin')
  ) then
    raise exception 'Solo el personal del cine puede validar entradas.';
  end if;
  return query
  select c.estado = 'pagada', c.estado, p.titulo, c.fecha_funcion,
         f.hora_inicio, s.nombre, array_agg(e.butaca_codigo order by e.butaca_codigo)
  from public.compras c
  join public.funciones f on f.id = c.funcion_id
  join public.peliculas p on p.id = f.pelicula_id
  join public.salas s on s.id = f.sala_id
  join public.entradas e on e.compra_id = c.id
  where c.codigo = upper(trim(p_codigo)) and c.qr_token = p_qr_token
  group by c.id, p.titulo, f.hora_inicio, s.nombre;
end;
$$;

alter table public.compras enable row level security;
drop policy if exists "compras: lectura propia" on public.compras;
create policy "compras: lectura propia" on public.compras for select to authenticated using (usuario_id = auth.uid());
drop policy if exists "entradas: lectura propia" on public.entradas;
create policy "entradas: lectura propia" on public.entradas for select to authenticated using (
  exists (select 1 from public.compras c where c.id = compra_id and c.usuario_id = auth.uid())
);

create or replace view public.compras_detalle with (security_invoker = true) as
select c.id, c.codigo, c.usuario_id, c.comprador_email, c.funcion_id,
       f.pelicula_id, p.titulo as pelicula_titulo, s.nombre as sala_nombre,
       c.fecha_funcion, f.hora_inicio, f.formato, f.idioma,
       c.total_centavos, c.credito_usado_centavos, c.pago_otro_centavos,
       c.medio_pago, c.estado, c.qr_token, c.aviso_adulto,
       c.creada_en, c.cancelada_en, coalesce(detalle.entradas, '[]'::jsonb) as entradas
from public.compras c
join public.funciones f on f.id = c.funcion_id
join public.peliculas p on p.id = f.pelicula_id
join public.salas s on s.id = f.sala_id
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'butaca_codigo', e.butaca_codigo, 'tipo', e.tipo, 'precio_centavos', e.precio_centavos
  ) order by e.butaca_codigo) as entradas
  from public.entradas e where e.compra_id = c.id
) detalle on true;

revoke all on public.compras from anon, authenticated;
revoke all on public.entradas from anon, authenticated;
grant select on public.compras, public.entradas, public.compras_detalle to authenticated;
revoke all on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text) from public;
grant execute on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text) to anon, authenticated;
revoke all on function public.cancelar_compra(uuid) from public;
grant execute on function public.cancelar_compra(uuid) to authenticated;
revoke all on function public.validar_entrada_qr(text, uuid) from public;
grant execute on function public.validar_entrada_qr(text, uuid) to authenticated;

-- ============================================================
-- CANDY BAR: PRODUCTOS (RF-034)
-- ============================================================
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

-- ============================================================
-- CANDY BAR: CATEGORÍAS (RF-035)
-- ============================================================
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

-- RF-036: productos del candy bar dentro de la misma compra de entradas.
-- Ejecutar después de 20260920_categorias_candy.sql.

alter table public.compras
add column if not exists entradas_total_centavos bigint not null default 0;

alter table public.compras
add column if not exists productos_total_centavos bigint not null default 0;

-- Las compras creadas antes del RF-036 solo contenían entradas.
update public.compras
set entradas_total_centavos = total_centavos
where entradas_total_centavos = 0 and productos_total_centavos = 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'compras_entradas_total_check' and conrelid = 'public.compras'::regclass
  ) then
    alter table public.compras add constraint compras_entradas_total_check
      check (entradas_total_centavos >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'compras_productos_total_check' and conrelid = 'public.compras'::regclass
  ) then
    alter table public.compras add constraint compras_productos_total_check
      check (productos_total_centavos >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'compras_desglose_total_check' and conrelid = 'public.compras'::regclass
  ) then
    alter table public.compras add constraint compras_desglose_total_check
      check (total_centavos = entradas_total_centavos + productos_total_centavos);
  end if;
end;
$$;

create table if not exists public.compra_productos (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras(id) on delete cascade,
  producto_id uuid not null references public.productos_candy(id) on delete restrict,
  producto_nombre text not null check (length(trim(producto_nombre)) between 2 and 100),
  cantidad integer not null check (cantidad between 1 and 20),
  precio_unitario_centavos integer not null check (precio_unitario_centavos > 0),
  subtotal_centavos bigint generated always as
    (cantidad::bigint * precio_unitario_centavos::bigint) stored,
  unique (compra_id, producto_id)
);

create index if not exists compra_productos_compra_idx
on public.compra_productos (compra_id);

alter table public.compra_productos enable row level security;

drop policy if exists "compra productos: lectura propia" on public.compra_productos;
create policy "compra productos: lectura propia" on public.compra_productos
for select to authenticated using (
  exists (
    select 1 from public.compras c
    where c.id = compra_id and c.usuario_id = auth.uid()
  )
);

-- Se reemplaza la versión anterior para evitar funciones sobrecargadas ambiguas en PostgREST.
drop function if exists public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb);
drop function if exists public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text);

create function public.confirmar_compra(
  p_funcion_id uuid,
  p_fecha date,
  p_codigos text[],
  p_sesion_token uuid,
  p_email text,
  p_fecha_nacimiento date,
  p_usar_credito boolean,
  p_medio_pago text,
  p_productos jsonb
)
returns table (
  compra_id uuid,
  compra_codigo text,
  compra_qr_token uuid,
  entradas_total_centavos bigint,
  productos_total_centavos bigint,
  total_centavos bigint,
  credito_usado_centavos bigint,
  pago_otro_centavos bigint,
  medio_pago text,
  aviso_adulto boolean,
  comprador_email text,
  creada_en timestamptz,
  productos jsonb
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_funcion public.funciones%rowtype;
  v_pelicula public.peliculas%rowtype;
  v_perfil public.perfiles%rowtype;
  v_compra public.compras%rowtype;
  v_usuario uuid := auth.uid();
  v_hash text;
  v_email text;
  v_nacimiento date;
  v_edad integer;
  v_edad_minima integer;
  v_cantidad integer;
  v_cantidad_productos integer := 0;
  v_entradas_total bigint;
  v_productos_total bigint := 0;
  v_total bigint;
  v_credito bigint := 0;
  v_otro bigint;
  v_medio text;
  v_productos jsonb := coalesce(p_productos, '[]'::jsonb);
  v_productos_confirmados jsonb := '[]'::jsonb;
begin
  if p_sesion_token is null then raise exception 'La sesión de reserva no es válida.'; end if;
  p_codigos := coalesce(p_codigos, array[]::text[]);
  if cardinality(p_codigos) = 0 then raise exception 'Elegí al menos una butaca.'; end if;
  if cardinality(p_codigos) <> (select count(distinct codigo) from unnest(p_codigos) as codigo) then
    raise exception 'La compra contiene butacas repetidas.';
  end if;

  if jsonb_typeof(v_productos) <> 'array' then
    raise exception 'La selección del candy bar no es válida.';
  end if;
  if jsonb_array_length(v_productos) > 50 then
    raise exception 'La compra contiene demasiados productos diferentes.';
  end if;
  begin
    if exists (
      select 1
      from jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
      where item.producto_id is null or item.cantidad is null
         or item.cantidad < 1 or item.cantidad > 20
    ) then
      raise exception 'Cada producto debe tener una cantidad entre 1 y 20.';
    end if;
    if jsonb_array_length(v_productos) <> (
      select count(distinct item.producto_id)
      from jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
    ) then
      raise exception 'La compra contiene productos repetidos.';
    end if;
  exception
    when invalid_text_representation or data_exception then
      raise exception 'La selección del candy bar no es válida.';
  end;

  select f.* into v_funcion
  from public.funciones f where f.id = p_funcion_id and f.activa;
  if not found then raise exception 'La función seleccionada no está disponible.'; end if;
  if p_fecha < v_funcion.fecha_desde or p_fecha > v_funcion.fecha_hasta
     or not (extract(isodow from p_fecha)::smallint = any(v_funcion.dias_semana)) then
    raise exception 'La fecha no corresponde a la programación seleccionada.';
  end if;
  if ((p_fecha + v_funcion.hora_inicio) at time zone 'America/Argentina/Buenos_Aires') <= now() then
    raise exception 'La función ya comenzó.';
  end if;

  select p.* into v_pelicula
  from public.peliculas p where p.id = v_funcion.pelicula_id;
  if not found then raise exception 'La película no está disponible.'; end if;

  if v_usuario is not null then
    select p.* into v_perfil from public.perfiles p where p.id = v_usuario for update;
    if not found then raise exception 'No se encontró el perfil de la cuenta.'; end if;
    v_email := lower(trim(v_perfil.email));
    v_nacimiento := v_perfil.fecha_nacimiento;
  else
    v_email := lower(trim(coalesce(p_email, '')));
    v_nacimiento := p_fecha_nacimiento;
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Ingresá un correo electrónico válido.';
    end if;
    if v_nacimiento is null or v_nacimiento > current_date then
      raise exception 'Ingresá una fecha de nacimiento válida.';
    end if;
  end if;

  v_edad := extract(year from age(p_fecha, v_nacimiento));
  v_edad_minima := case v_pelicula.clasificacion when '13' then 13 when '18' then 18 else 0 end;
  if v_edad < v_edad_minima then
    raise exception 'La clasificación % requiere tener al menos % años en la fecha de la función.',
      v_pelicula.clasificacion, v_edad_minima;
  end if;

  delete from public.reservas_butacas
  where estado = 'reservada' and expira_en <= now();
  v_hash := encode(digest(p_sesion_token::text, 'sha256'), 'hex');

  perform 1 from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada' and r.expira_en > now()
  for update;

  select count(*), coalesce(sum(r.precio_centavos), 0)
  into v_cantidad, v_entradas_total
  from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada' and r.expira_en > now();

  if v_cantidad <> cardinality(p_codigos) then
    raise exception 'La reserva venció o una de las butacas ya no está disponible.';
  end if;

  -- El servidor bloquea y consulta los productos publicados; nunca confía en precios enviados por el cliente.
  perform pc.id
  from public.productos_candy pc
  join jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
    on item.producto_id = pc.id
  where pc.activo
  for key share of pc;

  select count(*), coalesce(sum(pc.precio_centavos::bigint * item.cantidad), 0)
  into v_cantidad_productos, v_productos_total
  from jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
  join public.productos_candy pc on pc.id = item.producto_id and pc.activo;

  if v_cantidad_productos <> jsonb_array_length(v_productos) then
    raise exception 'Uno de los productos del candy ya no está disponible. Revisá la selección.';
  end if;

  v_total := v_entradas_total + v_productos_total;
  if coalesce(p_usar_credito, false) and v_usuario is not null then
    v_credito := least(v_perfil.credito_centavos, v_total);
  end if;
  v_otro := v_total - v_credito;
  if v_otro = 0 then
    v_medio := 'credito';
  else
    if p_medio_pago is null or p_medio_pago not in ('tarjeta_credito','tarjeta_debito','billetera_virtual') then
      raise exception 'Elegí un medio de pago válido.';
    end if;
    v_medio := p_medio_pago;
  end if;

  if v_credito > 0 then
    update public.perfiles
    set credito_centavos = credito_centavos - v_credito
    where id = v_usuario;
  end if;

  insert into public.compras (
    codigo, usuario_id, comprador_email, funcion_id, fecha_funcion,
    entradas_total_centavos, productos_total_centavos, total_centavos,
    credito_usado_centavos, pago_otro_centavos, medio_pago, aviso_adulto
  ) values (
    'UMB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_usuario, v_email, p_funcion_id, p_fecha,
    v_entradas_total, v_productos_total, v_total,
    v_credito, v_otro, v_medio, v_pelicula.clasificacion <> 'ATP'
  ) returning * into v_compra;

  insert into public.entradas (
    compra_id, pelicula_id, funcion_id, fecha_funcion, butaca_codigo,
    tipo, precio_centavos, aviso_adulto, estado
  )
  select v_compra.id, v_funcion.pelicula_id, p_funcion_id, p_fecha,
         r.butaca_codigo, r.tipo, r.precio_centavos,
         v_pelicula.clasificacion <> 'ATP', 'pagada'
  from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada';

  insert into public.compra_productos (
    compra_id, producto_id, producto_nombre, cantidad, precio_unitario_centavos
  )
  select v_compra.id, pc.id, pc.nombre, item.cantidad, pc.precio_centavos
  from jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
  join public.productos_candy pc on pc.id = item.producto_id and pc.activo;

  update public.reservas_butacas r
  set estado = 'ocupada', expira_en = null
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada';

  select coalesce(jsonb_agg(jsonb_build_object(
    'producto_id', cp.producto_id,
    'nombre', cp.producto_nombre,
    'cantidad', cp.cantidad,
    'precio_unitario_centavos', cp.precio_unitario_centavos,
    'subtotal_centavos', cp.subtotal_centavos
  ) order by cp.producto_nombre), '[]'::jsonb)
  into v_productos_confirmados
  from public.compra_productos cp where cp.compra_id = v_compra.id;

  return query select
    v_compra.id, v_compra.codigo, v_compra.qr_token,
    v_compra.entradas_total_centavos, v_compra.productos_total_centavos,
    v_compra.total_centavos, v_compra.credito_usado_centavos,
    v_compra.pago_otro_centavos, v_compra.medio_pago,
    v_compra.aviso_adulto, v_compra.comprador_email, v_compra.creada_en,
    v_productos_confirmados;
exception
  when unique_violation then
    raise exception 'Una de las butacas ya fue vendida. Volvé al mapa y elegí otra ubicación.' using errcode = '23505';
end;
$$;

create or replace view public.compras_detalle
with (security_invoker = true)
as
select c.id, c.codigo, c.usuario_id, c.comprador_email, c.funcion_id,
       f.pelicula_id, p.titulo as pelicula_titulo, s.nombre as sala_nombre,
       c.fecha_funcion, f.hora_inicio, f.formato, f.idioma,
       c.total_centavos, c.credito_usado_centavos, c.pago_otro_centavos,
       c.medio_pago, c.estado, c.qr_token, c.aviso_adulto,
       c.creada_en, c.cancelada_en,
       coalesce(detalle.entradas, '[]'::jsonb) as entradas,
       c.entradas_total_centavos, c.productos_total_centavos,
       coalesce(candy.productos, '[]'::jsonb) as productos
from public.compras c
join public.funciones f on f.id = c.funcion_id
join public.peliculas p on p.id = f.pelicula_id
join public.salas s on s.id = f.sala_id
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'butaca_codigo', e.butaca_codigo,
    'tipo', e.tipo,
    'precio_centavos', e.precio_centavos
  ) order by e.butaca_codigo) as entradas
  from public.entradas e where e.compra_id = c.id
) detalle on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'producto_id', cp.producto_id,
    'nombre', cp.producto_nombre,
    'cantidad', cp.cantidad,
    'precio_unitario_centavos', cp.precio_unitario_centavos,
    'subtotal_centavos', cp.subtotal_centavos
  ) order by cp.producto_nombre) as productos
  from public.compra_productos cp where cp.compra_id = c.id
) candy on true;

revoke all on public.compra_productos from anon, authenticated;
grant select on public.compra_productos to authenticated;
grant select on public.compras_detalle to authenticated;
revoke all on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb) from public;
grant execute on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb) to anon, authenticated;

-- RF-037, RF-038 y RF-039: retiro con el mismo QR y combos destacados.
-- Ejecutar después de 20260921_compra_candy.sql.

create table if not exists public.combos_candy (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 2 and 100),
  descripcion text not null check (length(trim(descripcion)) between 5 and 300),
  pochoclos_producto_id uuid not null references public.productos_candy(id) on delete restrict,
  bebida_producto_id uuid not null references public.productos_candy(id) on delete restrict,
  precio_centavos integer not null check (precio_centavos > 0),
  activo boolean not null default true,
  check (pochoclos_producto_id <> bebida_producto_id)
);

alter table public.combos_candy enable row level security;

drop policy if exists "combos: publicados o admin" on public.combos_candy;
create policy "combos: publicados o admin" on public.combos_candy
for select to anon, authenticated using (activo or public.es_admin());

drop policy if exists "combos: alta admin" on public.combos_candy;
create policy "combos: alta admin" on public.combos_candy
for insert to authenticated with check (public.es_admin());

drop policy if exists "combos: edicion admin" on public.combos_candy;
create policy "combos: edicion admin" on public.combos_candy
for update to authenticated using (public.es_admin()) with check (public.es_admin());

alter table public.compras
add column if not exists combos_total_centavos bigint not null default 0;
alter table public.compras
add column if not exists candy_retirado_en timestamptz;
alter table public.compras
add column if not exists candy_retirado_por uuid references public.perfiles(id) on delete set null;

alter table public.compras drop constraint if exists compras_desglose_total_check;
alter table public.compras add constraint compras_desglose_total_check
check (total_centavos = entradas_total_centavos + productos_total_centavos + combos_total_centavos);

-- Un mismo producto puede aparecer como adicional y dentro de varios combos.
alter table public.compra_productos drop constraint if exists compra_productos_cantidad_check;
alter table public.compra_productos add constraint compra_productos_cantidad_check
check (cantidad between 1 and 1000);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'compras_combos_total_check' and conrelid = 'public.compras'::regclass
  ) then
    alter table public.compras add constraint compras_combos_total_check
      check (combos_total_centavos >= 0);
  end if;
end;
$$;

create table if not exists public.compra_combos (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras(id) on delete cascade,
  combo_id uuid not null references public.combos_candy(id) on delete restrict,
  combo_nombre text not null check (length(trim(combo_nombre)) between 2 and 100),
  cantidad integer not null check (cantidad between 1 and 20),
  precio_unitario_centavos integer not null check (precio_unitario_centavos > 0),
  subtotal_centavos bigint generated always as
    (cantidad::bigint * precio_unitario_centavos::bigint) stored,
  unique (compra_id, combo_id)
);

create index if not exists compra_combos_compra_idx on public.compra_combos (compra_id);
alter table public.compra_combos enable row level security;

drop policy if exists "compra combos: lectura propia" on public.compra_combos;
create policy "compra combos: lectura propia" on public.compra_combos
for select to authenticated using (
  exists (
    select 1 from public.compras c
    where c.id = compra_id and c.usuario_id = auth.uid()
  )
);

-- PostgREST no debe encontrar versiones sobrecargadas de la misma operación.
drop function if exists public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb);
drop function if exists public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb);
drop function if exists public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text);

create function public.confirmar_compra(
  p_funcion_id uuid,
  p_fecha date,
  p_codigos text[],
  p_sesion_token uuid,
  p_email text,
  p_fecha_nacimiento date,
  p_usar_credito boolean,
  p_medio_pago text,
  p_productos jsonb,
  p_combos jsonb
)
returns table (
  compra_id uuid,
  compra_codigo text,
  compra_qr_token uuid,
  entradas_total_centavos bigint,
  productos_total_centavos bigint,
  combos_total_centavos bigint,
  total_centavos bigint,
  credito_usado_centavos bigint,
  pago_otro_centavos bigint,
  medio_pago text,
  aviso_adulto boolean,
  comprador_email text,
  creada_en timestamptz,
  productos jsonb,
  combos jsonb
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_funcion public.funciones%rowtype;
  v_pelicula public.peliculas%rowtype;
  v_perfil public.perfiles%rowtype;
  v_compra public.compras%rowtype;
  v_usuario uuid := auth.uid();
  v_hash text;
  v_email text;
  v_nacimiento date;
  v_edad integer;
  v_edad_minima integer;
  v_cantidad integer;
  v_cantidad_productos integer := 0;
  v_cantidad_combos_distintos integer := 0;
  v_cantidad_combos integer := 0;
  v_entradas_bruto bigint;
  v_entradas_en_combo bigint := 0;
  v_entradas_total bigint;
  v_productos_total bigint := 0;
  v_combos_total bigint := 0;
  v_total bigint;
  v_credito bigint := 0;
  v_otro bigint;
  v_medio text;
  v_productos jsonb := coalesce(p_productos, '[]'::jsonb);
  v_combos jsonb := coalesce(p_combos, '[]'::jsonb);
  v_productos_confirmados jsonb := '[]'::jsonb;
  v_combos_confirmados jsonb := '[]'::jsonb;
begin
  if p_sesion_token is null then raise exception 'La sesión de reserva no es válida.'; end if;
  p_codigos := coalesce(p_codigos, array[]::text[]);
  if cardinality(p_codigos) = 0 then raise exception 'Elegí al menos una butaca.'; end if;
  if cardinality(p_codigos) <> (select count(distinct codigo) from unnest(p_codigos) as codigo) then
    raise exception 'La compra contiene butacas repetidas.';
  end if;

  if jsonb_typeof(v_productos) <> 'array' or jsonb_typeof(v_combos) <> 'array' then
    raise exception 'La selección del candy bar no es válida.';
  end if;
  if jsonb_array_length(v_productos) > 50 or jsonb_array_length(v_combos) > 20 then
    raise exception 'La compra contiene demasiados productos o combos diferentes.';
  end if;
  begin
    if exists (
      select 1 from jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
      where item.producto_id is null or item.cantidad is null or item.cantidad < 1 or item.cantidad > 20
    ) then raise exception 'Cada producto debe tener una cantidad entre 1 y 20.'; end if;
    if jsonb_array_length(v_productos) <> (
      select count(distinct item.producto_id)
      from jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
    ) then raise exception 'La compra contiene productos repetidos.'; end if;

    if exists (
      select 1 from jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer)
      where item.combo_id is null or item.cantidad is null or item.cantidad < 1 or item.cantidad > 20
    ) then raise exception 'Cada combo debe tener una cantidad entre 1 y 20.'; end if;
    if jsonb_array_length(v_combos) <> (
      select count(distinct item.combo_id)
      from jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer)
    ) then raise exception 'La compra contiene combos repetidos.'; end if;
  exception
    when invalid_text_representation or data_exception then
      raise exception 'La selección del candy bar no es válida.';
  end;

  select f.* into v_funcion from public.funciones f where f.id = p_funcion_id and f.activa;
  if not found then raise exception 'La función seleccionada no está disponible.'; end if;
  if p_fecha < v_funcion.fecha_desde or p_fecha > v_funcion.fecha_hasta
     or not (extract(isodow from p_fecha)::smallint = any(v_funcion.dias_semana)) then
    raise exception 'La fecha no corresponde a la programación seleccionada.';
  end if;
  if ((p_fecha + v_funcion.hora_inicio) at time zone 'America/Argentina/Buenos_Aires') <= now() then
    raise exception 'La función ya comenzó.';
  end if;

  select p.* into v_pelicula from public.peliculas p where p.id = v_funcion.pelicula_id;
  if not found then raise exception 'La película no está disponible.'; end if;

  if v_usuario is not null then
    select p.* into v_perfil from public.perfiles p where p.id = v_usuario for update;
    if not found then raise exception 'No se encontró el perfil de la cuenta.'; end if;
    v_email := lower(trim(v_perfil.email));
    v_nacimiento := v_perfil.fecha_nacimiento;
  else
    v_email := lower(trim(coalesce(p_email, '')));
    v_nacimiento := p_fecha_nacimiento;
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Ingresá un correo electrónico válido.';
    end if;
    if v_nacimiento is null or v_nacimiento > current_date then
      raise exception 'Ingresá una fecha de nacimiento válida.';
    end if;
  end if;

  v_edad := extract(year from age(p_fecha, v_nacimiento));
  v_edad_minima := case v_pelicula.clasificacion when '13' then 13 when '18' then 18 else 0 end;
  if v_edad < v_edad_minima then
    raise exception 'La clasificación % requiere tener al menos % años en la fecha de la función.',
      v_pelicula.clasificacion, v_edad_minima;
  end if;

  delete from public.reservas_butacas where estado = 'reservada' and expira_en <= now();
  v_hash := encode(digest(p_sesion_token::text, 'sha256'), 'hex');

  perform 1 from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada' and r.expira_en > now()
  for update;

  select count(*), coalesce(sum(r.precio_centavos), 0)
  into v_cantidad, v_entradas_bruto
  from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada' and r.expira_en > now();
  if v_cantidad <> cardinality(p_codigos) then
    raise exception 'La reserva venció o una de las butacas ya no está disponible.';
  end if;

  perform pc.id
  from public.productos_candy pc
  join jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
    on item.producto_id = pc.id
  where pc.activo for key share of pc;

  select count(*), coalesce(sum(pc.precio_centavos::bigint * item.cantidad), 0)
  into v_cantidad_productos, v_productos_total
  from jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
  join public.productos_candy pc on pc.id = item.producto_id and pc.activo;
  if v_cantidad_productos <> jsonb_array_length(v_productos) then
    raise exception 'Uno de los productos del candy ya no está disponible. Revisá la selección.';
  end if;

  perform c.id
  from public.combos_candy c
  join jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer) on item.combo_id = c.id
  where c.activo for key share of c;

  perform pc.id
  from public.productos_candy pc
  where pc.activo and pc.id in (
    select c.pochoclos_producto_id
    from public.combos_candy c
    join jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer) on item.combo_id = c.id
    union
    select c.bebida_producto_id
    from public.combos_candy c
    join jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer) on item.combo_id = c.id
  ) for key share;

  select count(*), coalesce(sum(item.cantidad), 0),
         coalesce(sum(c.precio_centavos::bigint * item.cantidad), 0)
  into v_cantidad_combos_distintos, v_cantidad_combos, v_combos_total
  from jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer)
  join public.combos_candy c on c.id = item.combo_id and c.activo
  join public.productos_candy pp on pp.id = c.pochoclos_producto_id and pp.activo
  join public.productos_candy pb on pb.id = c.bebida_producto_id and pb.activo;
  if v_cantidad_combos_distintos <> jsonb_array_length(v_combos) then
    raise exception 'Uno de los combos ya no está disponible. Revisá la selección.';
  end if;
  if v_cantidad_combos > cardinality(p_codigos) then
    raise exception 'Solo se puede comprar un combo por entrada.';
  end if;

  select coalesce(sum(seleccion.precio_centavos), 0) into v_entradas_en_combo
  from (
    select r.precio_centavos
    from public.reservas_butacas r
    where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
      and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
      and r.estado = 'reservada'
    order by r.precio_centavos, r.butaca_codigo
    limit v_cantidad_combos
  ) seleccion;
  v_entradas_total := v_entradas_bruto - v_entradas_en_combo;
  v_total := v_entradas_total + v_productos_total + v_combos_total;

  if coalesce(p_usar_credito, false) and v_usuario is not null then
    v_credito := least(v_perfil.credito_centavos, v_total);
  end if;
  v_otro := v_total - v_credito;
  if v_otro = 0 then
    v_medio := 'credito';
  else
    if p_medio_pago is null or p_medio_pago not in ('tarjeta_credito','tarjeta_debito','billetera_virtual') then
      raise exception 'Elegí un medio de pago válido.';
    end if;
    v_medio := p_medio_pago;
  end if;

  if v_credito > 0 then
    update public.perfiles set credito_centavos = credito_centavos - v_credito where id = v_usuario;
  end if;

  insert into public.compras (
    codigo, usuario_id, comprador_email, funcion_id, fecha_funcion,
    entradas_total_centavos, productos_total_centavos, combos_total_centavos,
    total_centavos, credito_usado_centavos, pago_otro_centavos, medio_pago, aviso_adulto
  ) values (
    'UMB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_usuario, v_email, p_funcion_id, p_fecha,
    v_entradas_total, v_productos_total, v_combos_total,
    v_total, v_credito, v_otro, v_medio, v_pelicula.clasificacion <> 'ATP'
  ) returning * into v_compra;

  insert into public.entradas (
    compra_id, pelicula_id, funcion_id, fecha_funcion, butaca_codigo,
    tipo, precio_centavos, aviso_adulto, estado
  )
  select v_compra.id, v_funcion.pelicula_id, p_funcion_id, p_fecha,
         r.butaca_codigo, r.tipo, r.precio_centavos,
         v_pelicula.clasificacion <> 'ATP', 'pagada'
  from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada';

  insert into public.compra_combos (
    compra_id, combo_id, combo_nombre, cantidad, precio_unitario_centavos
  )
  select v_compra.id, c.id, c.nombre, item.cantidad, c.precio_centavos
  from jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer)
  join public.combos_candy c on c.id = item.combo_id and c.activo;

  with cantidades as (
    select item.producto_id, item.cantidad
    from jsonb_to_recordset(v_productos) as item(producto_id uuid, cantidad integer)
    union all
    select c.pochoclos_producto_id, item.cantidad
    from jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer)
    join public.combos_candy c on c.id = item.combo_id
    union all
    select c.bebida_producto_id, item.cantidad
    from jsonb_to_recordset(v_combos) as item(combo_id uuid, cantidad integer)
    join public.combos_candy c on c.id = item.combo_id
  ), agrupados as (
    select producto_id, sum(cantidad)::integer as cantidad from cantidades group by producto_id
  )
  insert into public.compra_productos (
    compra_id, producto_id, producto_nombre, cantidad, precio_unitario_centavos
  )
  select v_compra.id, pc.id, pc.nombre, a.cantidad, pc.precio_centavos
  from agrupados a join public.productos_candy pc on pc.id = a.producto_id and pc.activo;

  update public.reservas_butacas r set estado = 'ocupada', expira_en = null
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada';

  select coalesce(jsonb_agg(jsonb_build_object(
    'producto_id', cp.producto_id, 'nombre', cp.producto_nombre,
    'cantidad', cp.cantidad, 'precio_unitario_centavos', cp.precio_unitario_centavos,
    'subtotal_centavos', cp.subtotal_centavos
  ) order by cp.producto_nombre), '[]'::jsonb)
  into v_productos_confirmados
  from public.compra_productos cp where cp.compra_id = v_compra.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'combo_id', cc.combo_id, 'nombre', cc.combo_nombre,
    'cantidad', cc.cantidad, 'precio_unitario_centavos', cc.precio_unitario_centavos,
    'subtotal_centavos', cc.subtotal_centavos
  ) order by cc.combo_nombre), '[]'::jsonb)
  into v_combos_confirmados
  from public.compra_combos cc where cc.compra_id = v_compra.id;

  return query select
    v_compra.id, v_compra.codigo, v_compra.qr_token,
    v_compra.entradas_total_centavos, v_compra.productos_total_centavos,
    v_compra.combos_total_centavos, v_compra.total_centavos,
    v_compra.credito_usado_centavos, v_compra.pago_otro_centavos,
    v_compra.medio_pago, v_compra.aviso_adulto,
    v_compra.comprador_email, v_compra.creada_en,
    v_productos_confirmados, v_combos_confirmados;
exception
  when unique_violation then
    raise exception 'Una de las butacas ya fue vendida. Volvé al mapa y elegí otra ubicación.' using errcode = '23505';
end;
$$;

-- El retiro se controla por separado del ingreso a sala para que el mismo QR sirva para ambas acciones.
drop function if exists public.validar_entrada_qr(text, uuid);
create function public.validar_entrada_qr(p_codigo text, p_qr_token uuid)
returns table (
  valida boolean,
  estado text,
  compra_codigo text,
  pelicula_titulo text,
  fecha_funcion date,
  hora_inicio time,
  sala_nombre text,
  butacas text[],
  productos jsonb,
  combos jsonb,
  candy_retirado_en timestamptz
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol in ('empleado','admin')
  ) then raise exception 'Solo el personal del cine puede validar compras.'; end if;

  return query
  select c.estado = 'pagada', c.estado, c.codigo, p.titulo, c.fecha_funcion,
         f.hora_inicio, s.nombre,
         array(select e.butaca_codigo from public.entradas e where e.compra_id = c.id order by e.butaca_codigo),
         coalesce((select jsonb_agg(jsonb_build_object(
           'producto_id', cp.producto_id, 'nombre', cp.producto_nombre,
           'cantidad', cp.cantidad, 'precio_unitario_centavos', cp.precio_unitario_centavos,
           'subtotal_centavos', cp.subtotal_centavos
         ) order by cp.producto_nombre) from public.compra_productos cp where cp.compra_id = c.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
           'combo_id', cc.combo_id, 'nombre', cc.combo_nombre,
           'cantidad', cc.cantidad, 'precio_unitario_centavos', cc.precio_unitario_centavos,
           'subtotal_centavos', cc.subtotal_centavos
         ) order by cc.combo_nombre) from public.compra_combos cc where cc.compra_id = c.id), '[]'::jsonb),
         c.candy_retirado_en
  from public.compras c
  join public.funciones f on f.id = c.funcion_id
  join public.peliculas p on p.id = f.pelicula_id
  join public.salas s on s.id = f.sala_id
  where c.codigo = upper(trim(p_codigo)) and c.qr_token = p_qr_token;
end;
$$;

create or replace function public.retirar_candy(p_codigo text, p_qr_token uuid)
returns table (compra_codigo text, productos jsonb, retirado_en timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compra public.compras%rowtype;
  v_productos jsonb;
begin
  if not exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol in ('empleado','admin')
  ) then raise exception 'Solo el personal del cine puede registrar retiros.'; end if;

  select c.* into v_compra from public.compras c
  where c.codigo = upper(trim(p_codigo)) and c.qr_token = p_qr_token
  for update;
  if not found then raise exception 'No se encontró una compra para ese QR.'; end if;
  if v_compra.estado <> 'pagada' then raise exception 'La compra no está vigente.'; end if;
  if v_compra.candy_retirado_en is not null then raise exception 'El candy de esta compra ya fue retirado.'; end if;
  if not exists (select 1 from public.compra_productos cp where cp.compra_id = v_compra.id) then
    raise exception 'La compra no contiene productos del candy.';
  end if;

  update public.compras set candy_retirado_en = now(), candy_retirado_por = auth.uid()
  where id = v_compra.id returning candy_retirado_en into v_compra.candy_retirado_en;

  select coalesce(jsonb_agg(jsonb_build_object(
    'producto_id', cp.producto_id, 'nombre', cp.producto_nombre, 'cantidad', cp.cantidad
  ) order by cp.producto_nombre), '[]'::jsonb)
  into v_productos from public.compra_productos cp where cp.compra_id = v_compra.id;
  return query select v_compra.codigo, v_productos, v_compra.candy_retirado_en;
end;
$$;

create or replace function public.cancelar_compra(p_compra_id uuid)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compra public.compras%rowtype;
  v_hora time;
  v_credito bigint;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para cancelar una compra.'; end if;
  select c.* into v_compra from public.compras c where c.id = p_compra_id for update;
  if not found or v_compra.usuario_id is distinct from auth.uid() then raise exception 'La compra no pertenece a tu cuenta.'; end if;
  if v_compra.estado <> 'pagada' then raise exception 'La compra ya está cancelada.'; end if;
  if v_compra.candy_retirado_en is not null then
    raise exception 'La compra no puede cancelarse porque el pedido del candy ya fue retirado.';
  end if;
  select f.hora_inicio into v_hora from public.funciones f where f.id = v_compra.funcion_id;
  if ((v_compra.fecha_funcion + v_hora) at time zone 'America/Argentina/Buenos_Aires') < now() + interval '2 hours' then
    raise exception 'La cancelación solo está disponible hasta 2 horas antes de la función.';
  end if;
  update public.perfiles set credito_centavos = credito_centavos + v_compra.total_centavos
  where id = auth.uid() returning credito_centavos into v_credito;
  delete from public.reservas_butacas r using public.entradas e
  where e.compra_id = v_compra.id and e.estado = 'pagada'
    and r.funcion_id = e.funcion_id and r.fecha_funcion = e.fecha_funcion
    and r.butaca_codigo = e.butaca_codigo and r.estado = 'ocupada';
  update public.entradas set estado = 'cancelada' where compra_id = v_compra.id and estado = 'pagada';
  update public.compras set estado = 'cancelada', cancelada_en = now() where id = v_compra.id;
  return v_credito;
end;
$$;

create or replace view public.compras_detalle with (security_invoker = true) as
select c.id, c.codigo, c.usuario_id, c.comprador_email, c.funcion_id,
       f.pelicula_id, p.titulo as pelicula_titulo, s.nombre as sala_nombre,
       c.fecha_funcion, f.hora_inicio, f.formato, f.idioma,
       c.total_centavos, c.credito_usado_centavos, c.pago_otro_centavos,
       c.medio_pago, c.estado, c.qr_token, c.aviso_adulto,
       c.creada_en, c.cancelada_en,
       coalesce(detalle.entradas, '[]'::jsonb) as entradas,
       c.entradas_total_centavos, c.productos_total_centavos,
       coalesce(candy.productos, '[]'::jsonb) as productos,
       c.combos_total_centavos,
       coalesce(combo_detalle.combos, '[]'::jsonb) as combos,
       c.candy_retirado_en
from public.compras c
join public.funciones f on f.id = c.funcion_id
join public.peliculas p on p.id = f.pelicula_id
join public.salas s on s.id = f.sala_id
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'butaca_codigo', e.butaca_codigo, 'tipo', e.tipo, 'precio_centavos', e.precio_centavos
  ) order by e.butaca_codigo) as entradas
  from public.entradas e where e.compra_id = c.id
) detalle on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'producto_id', cp.producto_id, 'nombre', cp.producto_nombre,
    'cantidad', cp.cantidad, 'precio_unitario_centavos', cp.precio_unitario_centavos,
    'subtotal_centavos', cp.subtotal_centavos
  ) order by cp.producto_nombre) as productos
  from public.compra_productos cp where cp.compra_id = c.id
) candy on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'combo_id', cc.combo_id, 'nombre', cc.combo_nombre,
    'cantidad', cc.cantidad, 'precio_unitario_centavos', cc.precio_unitario_centavos,
    'subtotal_centavos', cc.subtotal_centavos
  ) order by cc.combo_nombre) as combos
  from public.compra_combos cc where cc.compra_id = c.id
) combo_detalle on true;

revoke all on public.combos_candy from anon, authenticated;
grant select on public.combos_candy to anon, authenticated;
grant insert, update on public.combos_candy to authenticated;
revoke all on public.compra_combos from anon, authenticated;
grant select on public.compra_combos to authenticated;
grant select on public.compras_detalle to authenticated;

revoke all on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb) from public;
grant execute on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb) to anon, authenticated;
revoke all on function public.validar_entrada_qr(text, uuid) from public;
grant execute on function public.validar_entrada_qr(text, uuid) to authenticated;
revoke all on function public.retirar_candy(text, uuid) from public;
grant execute on function public.retirar_candy(text, uuid) to authenticated;
