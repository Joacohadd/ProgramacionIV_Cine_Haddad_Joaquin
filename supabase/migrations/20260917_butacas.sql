-- Migración del punto 4.5: mapa, reservas temporales y disponibilidad en tiempo real.
-- Ejecutar después de 20260916_funciones_salas.sql.

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
  check (
    (estado = 'reservada' and expira_en is not null)
    or (estado = 'ocupada')
  )
);

create index if not exists reservas_butacas_funcion_fecha_idx
on public.reservas_butacas (funcion_id, fecha_funcion);

create index if not exists reservas_butacas_expiracion_idx
on public.reservas_butacas (expira_en)
where estado = 'reservada';

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
  if p_sesion_token is null then
    raise exception 'La sesión de selección no es válida.';
  end if;

  p_codigos := coalesce(p_codigos, array[]::text[]);
  if cardinality(p_codigos) <> (select count(distinct codigo) from unnest(p_codigos) as codigo) then
    raise exception 'La selección contiene butacas repetidas.';
  end if;

  select f.* into v_funcion
  from public.funciones f
  where f.id = p_funcion_id and f.activa;

  if not found then
    raise exception 'La función seleccionada no está disponible.';
  end if;

  if p_fecha < v_funcion.fecha_desde
     or p_fecha > v_funcion.fecha_hasta
     or not (extract(isodow from p_fecha)::smallint = any(v_funcion.dias_semana)) then
    raise exception 'La fecha no corresponde a la programación seleccionada.';
  end if;

  select s.* into v_sala from public.salas s
  where s.id = v_funcion.sala_id and s.activa;
  if not found then
    raise exception 'La sala no está disponible.';
  end if;

  delete from public.reservas_butacas
  where estado = 'reservada' and expira_en <= now();

  v_hash := encode(digest(p_sesion_token::text, 'sha256'), 'hex');

  delete from public.reservas_butacas
  where funcion_id = p_funcion_id
    and fecha_funcion = p_fecha
    and sesion_hash = v_hash
    and estado = 'reservada';

  foreach v_codigo in array p_codigos loop
    if v_codigo !~ '^[A-Z]-[0-9]{2,3}$' then
      raise exception 'El código de butaca % no es válido.', v_codigo;
    end if;

    v_fila := split_part(v_codigo, '-', 1);
    v_numero := split_part(v_codigo, '-', 2)::integer;
    v_fila_numero := ascii(v_fila) - 64;

    if v_fila_numero < 1 or v_fila_numero > v_sala.filas then
      raise exception 'La fila % no existe en esta sala.', v_fila;
    end if;

    if v_fila in ('J', 'K') then
      v_tipo := 'accesible';
      v_maximo := 14;
    elsif v_fila in ('R', 'S', 'T') then
      v_tipo := 'vip';
      v_maximo := v_sala.butacas_izquierda + v_sala.butacas_centro + v_sala.butacas_derecha;
    else
      v_tipo := 'estandar';
      v_maximo := v_sala.butacas_izquierda + v_sala.butacas_centro + v_sala.butacas_derecha;
    end if;

    if v_numero < 1 or v_numero > v_maximo then
      raise exception 'La butaca % no existe en esta sala.', v_codigo;
    end if;

    v_precio := 800000 + case when v_tipo = 'vip' then 300000 else 0 end;
    insert into public.reservas_butacas (
      funcion_id, fecha_funcion, butaca_codigo, tipo, estado,
      sesion_hash, precio_centavos, expira_en
    ) values (
      p_funcion_id, p_fecha, v_codigo, v_tipo, 'reservada',
      v_hash, v_precio, now() + interval '8 minutes'
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
create policy "butacas: disponibilidad pública"
on public.reservas_butacas for select to anon, authenticated
using (estado = 'ocupada' or expira_en > now());

revoke all on public.reservas_butacas from anon, authenticated;
grant select on public.reservas_butacas to anon, authenticated;
revoke all on function public.sincronizar_reserva_butacas(uuid, date, text[], uuid) from public;
grant execute on function public.sincronizar_reserva_butacas(uuid, date, text[], uuid) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reservas_butacas'
  ) then
    alter publication supabase_realtime add table public.reservas_butacas;
  end if;
end;
$$;
