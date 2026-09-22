-- Migración del punto 4.6: compras, entradas con QR, crédito y cancelaciones.
-- Ejecutar después de 20260917_butacas.sql.

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

-- El contenido UMBRAL|código|token del QR se valida con esta función.
-- Solo los perfiles de personal pueden consultar una entrada ajena.
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
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

create unique index if not exists entradas_butaca_pagada_unica_idx
on public.entradas (funcion_id, fecha_funcion, butaca_codigo)
where estado = 'pagada' and funcion_id is not null and fecha_funcion is not null and butaca_codigo is not null;

create index if not exists entradas_compra_idx on public.entradas (compra_id);

create or replace function public.confirmar_compra(
  p_funcion_id uuid,
  p_fecha date,
  p_codigos text[],
  p_sesion_token uuid,
  p_email text,
  p_fecha_nacimiento date,
  p_usar_credito boolean,
  p_medio_pago text
)
returns table (
  compra_id uuid,
  compra_codigo text,
  compra_qr_token uuid,
  total_centavos bigint,
  credito_usado_centavos bigint,
  pago_otro_centavos bigint,
  medio_pago text,
  aviso_adulto boolean,
  comprador_email text,
  creada_en timestamptz
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
    raise exception 'La clasificación % requiere tener al menos % años en la fecha de la función.', v_pelicula.clasificacion, v_edad_minima;
  end if;

  delete from public.reservas_butacas where estado = 'reservada' and expira_en <= now();
  v_hash := encode(digest(p_sesion_token::text, 'sha256'), 'hex');

  perform 1 from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada' and r.expira_en > now()
  for update;

  select count(*), coalesce(sum(r.precio_centavos), 0)
  into v_cantidad, v_total
  from public.reservas_butacas r
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada' and r.expira_en > now();

  if v_cantidad <> cardinality(p_codigos) then
    raise exception 'La reserva venció o una de las butacas ya no está disponible.';
  end if;

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
    total_centavos, credito_usado_centavos, pago_otro_centavos,
    medio_pago, aviso_adulto
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
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada';

  update public.reservas_butacas r
  set estado = 'ocupada', expira_en = null
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.butaca_codigo = any(p_codigos) and r.sesion_hash = v_hash
    and r.estado = 'reservada';

  return query select
    v_compra.id, v_compra.codigo, v_compra.qr_token,
    v_compra.total_centavos, v_compra.credito_usado_centavos,
    v_compra.pago_otro_centavos, v_compra.medio_pago,
    v_compra.aviso_adulto, v_compra.comprador_email, v_compra.creada_en;
exception
  when unique_violation then
    raise exception 'Una de las butacas ya fue vendida. Volvé al mapa y elegí otra ubicación.' using errcode = '23505';
end;
$$;

create or replace function public.cancelar_compra(p_compra_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_compra public.compras%rowtype;
  v_hora time;
  v_credito bigint;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para cancelar una compra.'; end if;
  select c.* into v_compra from public.compras c where c.id = p_compra_id for update;
  if not found or v_compra.usuario_id is distinct from auth.uid() then
    raise exception 'La compra no pertenece a tu cuenta.';
  end if;
  if v_compra.estado <> 'pagada' then raise exception 'La compra ya está cancelada.'; end if;

  select f.hora_inicio into v_hora from public.funciones f where f.id = v_compra.funcion_id;
  if ((v_compra.fecha_funcion + v_hora) at time zone 'America/Argentina/Buenos_Aires') < now() + interval '2 hours' then
    raise exception 'La cancelación solo está disponible hasta 2 horas antes de la función.';
  end if;

  update public.perfiles
  set credito_centavos = credito_centavos + v_compra.total_centavos
  where id = auth.uid()
  returning credito_centavos into v_credito;

  delete from public.reservas_butacas r
  using public.entradas e
  where e.compra_id = v_compra.id and e.estado = 'pagada'
    and r.funcion_id = e.funcion_id and r.fecha_funcion = e.fecha_funcion
    and r.butaca_codigo = e.butaca_codigo and r.estado = 'ocupada';

  update public.entradas set estado = 'cancelada' where compra_id = v_compra.id and estado = 'pagada';
  update public.compras set estado = 'cancelada', cancelada_en = now() where id = v_compra.id;
  return v_credito;
end;
$$;

alter table public.compras enable row level security;

drop policy if exists "compras: lectura propia" on public.compras;
create policy "compras: lectura propia" on public.compras
for select to authenticated using (usuario_id = auth.uid());

drop policy if exists "entradas: lectura propia" on public.entradas;
create policy "entradas: lectura propia" on public.entradas
for select to authenticated using (
  exists (select 1 from public.compras c where c.id = compra_id and c.usuario_id = auth.uid())
);

create or replace view public.compras_detalle
with (security_invoker = true)
as
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
    'butaca_codigo', e.butaca_codigo,
    'tipo', e.tipo,
    'precio_centavos', e.precio_centavos
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
