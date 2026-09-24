-- Punto 4.10: próximos estrenos, alertas, preventa e historial visual.

alter table public.peliculas
  add column if not exists preventa_habilitada boolean not null default false,
  add column if not exists precio_preventa_centavos integer;

alter table public.peliculas drop constraint if exists peliculas_preventa_precio_check;
alter table public.peliculas add constraint peliculas_preventa_precio_check check (
  (not preventa_habilitada and precio_preventa_centavos is null)
  or (preventa_habilitada and precio_preventa_centavos > 0)
);

create table if not exists public.alertas_peliculas (
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  pelicula_id uuid not null references public.peliculas(id) on delete cascade,
  creada_en timestamptz not null default now(),
  notificada_en timestamptz,
  vista_en timestamptz,
  primary key (usuario_id, pelicula_id)
);

alter table public.alertas_peliculas add column if not exists vista_en timestamptz;

alter table public.alertas_peliculas enable row level security;

drop policy if exists "alertas: lectura propia" on public.alertas_peliculas;
create policy "alertas: lectura propia" on public.alertas_peliculas
for select to authenticated using (usuario_id = auth.uid());

drop policy if exists "alertas: alta propia" on public.alertas_peliculas;
create policy "alertas: alta propia" on public.alertas_peliculas
for insert to authenticated with check (
  usuario_id = auth.uid()
  and exists (
    select 1 from public.peliculas p
    where p.id = pelicula_id and p.visible_inicio
      and p.fecha_estreno > (now() at time zone 'America/Argentina/Buenos_Aires')::date
  )
);

drop policy if exists "alertas: baja propia" on public.alertas_peliculas;
create policy "alertas: baja propia" on public.alertas_peliculas
for delete to authenticated using (usuario_id = auth.uid());

drop policy if exists "alertas: marcar vista" on public.alertas_peliculas;
create policy "alertas: marcar vista" on public.alertas_peliculas
for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

create or replace view public.peliculas_con_ventas as
select p.id, p.titulo, p.sinopsis, p.duracion_minutos, p.imagen_url,
       p.generos, p.clasificacion, p.visible_inicio, p.fecha_estreno,
       coalesce(v.total, 0)::integer as entradas_vendidas,
       coalesce(r.promedio, 0)::numeric(3,1) as promedio_calificacion,
       coalesce(r.cantidad, 0)::integer as cantidad_resenas,
       p.preventa_habilitada, p.precio_preventa_centavos
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
       p.duracion_minutos, s.nombre as sala_nombre,
       p.fecha_estreno, p.preventa_habilitada, p.precio_preventa_centavos
from public.funciones f
join public.peliculas p on p.id = f.pelicula_id
join public.salas s on s.id = f.sala_id
where public.es_admin() or (f.activa and p.visible_inicio and s.activa);

create or replace function public.mis_alertas_peliculas()
returns table (
  pelicula_id uuid,
  pelicula_titulo text,
  pelicula_imagen_url text,
  fecha_estreno date,
  creada_en timestamptz,
  notificada_en timestamptz,
  venta_disponible boolean,
  notificacion_pendiente boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if v_usuario is null then
    raise exception 'Iniciá sesión para consultar tus alertas.';
  end if;

  return query
  with pendientes as (
    update public.alertas_peliculas a
    set notificada_en = now()
    where a.usuario_id = v_usuario
      and a.notificada_en is null
      and exists (
        select 1
        from public.peliculas p
        where p.id = a.pelicula_id
          and (
            v_hoy >= p.fecha_estreno
            or (
              p.preventa_habilitada
              and p.precio_preventa_centavos is not null
              and v_hoy >= p.fecha_estreno - 7
              and v_hoy < p.fecha_estreno
            )
          )
          and exists (
            select 1 from public.funciones f
            where f.pelicula_id = p.id and f.activa and f.fecha_hasta >= v_hoy
          )
      )
    returning a.pelicula_id, a.notificada_en
  )
  select a.pelicula_id, p.titulo, p.imagen_url, p.fecha_estreno,
         a.creada_en, coalesce(pe.notificada_en, a.notificada_en),
         (
           (
             v_hoy >= p.fecha_estreno
             or (
               p.preventa_habilitada
               and p.precio_preventa_centavos is not null
               and v_hoy >= p.fecha_estreno - 7
               and v_hoy < p.fecha_estreno
             )
           )
           and exists (
             select 1 from public.funciones f
             where f.pelicula_id = p.id and f.activa and f.fecha_hasta >= v_hoy
           )
         ) as venta_disponible,
         coalesce(pe.notificada_en, a.notificada_en) is not null
           and a.vista_en is null as notificacion_pendiente
  from public.alertas_peliculas a
  join public.peliculas p on p.id = a.pelicula_id
  left join pendientes pe on pe.pelicula_id = a.pelicula_id
  where a.usuario_id = v_usuario
  order by p.fecha_estreno;
end;
$$;

create or replace view public.mis_peliculas with (security_invoker = true) as
select c.id as compra_id, p.id as pelicula_id, p.titulo as pelicula_titulo,
       p.imagen_url as pelicula_imagen_url, c.fecha_funcion,
       f.formato, f.idioma, r.estrellas as calificacion_propia
from public.compras c
join public.funciones f on f.id = c.funcion_id
join public.peliculas p on p.id = f.pelicula_id
left join public.resenas r
  on r.pelicula_id = p.id and r.usuario_id = auth.uid()
where c.usuario_id = auth.uid()
  and c.estado = 'pagada'
  and ((c.fecha_funcion + f.hora_inicio) at time zone 'America/Argentina/Buenos_Aires') <= now();

-- Conserva la validación completa del mapa y reemplaza únicamente el precio
-- base mientras la preventa está vigente.
do $$
begin
  if to_regprocedure('public.sincronizar_reserva_butacas(uuid,date,text[],uuid)') is not null
     and to_regprocedure('public.sincronizar_reserva_butacas_sin_preventa(uuid,date,text[],uuid)') is null then
    execute 'alter function public.sincronizar_reserva_butacas(uuid, date, text[], uuid) rename to sincronizar_reserva_butacas_sin_preventa';
  end if;
end;
$$;

drop function if exists public.sincronizar_reserva_butacas(uuid, date, text[], uuid);
create function public.sincronizar_reserva_butacas(
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
  v_pelicula public.peliculas%rowtype;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_precio_base integer := 800000;
  v_hash text;
  v_cantidad integer;
begin
  select p.* into v_pelicula
  from public.funciones f
  join public.peliculas p on p.id = f.pelicula_id
  where f.id = p_funcion_id and f.activa and p.visible_inicio;

  if not found then raise exception 'La función seleccionada no está disponible.'; end if;
  if v_hoy < v_pelicula.fecha_estreno then
    if not v_pelicula.preventa_habilitada
       or v_pelicula.precio_preventa_centavos is null
       or v_hoy < v_pelicula.fecha_estreno - 7 then
      raise exception 'La venta de entradas todavía no comenzó.';
    end if;
    v_precio_base := v_pelicula.precio_preventa_centavos;
  end if;

  v_cantidad := public.sincronizar_reserva_butacas_sin_preventa(
    p_funcion_id, p_fecha, p_codigos, p_sesion_token
  );

  v_hash := encode(digest(p_sesion_token::text, 'sha256'), 'hex');
  update public.reservas_butacas r
  set precio_centavos = v_precio_base + case when r.tipo = 'vip' then 300000 else 0 end
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.sesion_hash = v_hash and r.estado = 'reservada';

  return v_cantidad;
end;
$$;

-- La confirmación vuelve a comprobar la fecha y actualiza el precio de la
-- reserva por si el período de preventa terminó durante el checkout.
do $$
begin
  if to_regprocedure('public.confirmar_compra(uuid,date,text[],uuid,text,date,boolean,text,jsonb,jsonb,uuid)') is not null
     and to_regprocedure('public.confirmar_compra_sin_preventa(uuid,date,text[],uuid,text,date,boolean,text,jsonb,jsonb,uuid)') is null then
    execute 'alter function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) rename to confirmar_compra_sin_preventa';
  end if;
end;
$$;

drop function if exists public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid);
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
  p_combos jsonb,
  p_cupon_id uuid
)
returns table (
  compra_id uuid,
  compra_codigo text,
  compra_qr_token uuid,
  entradas_total_centavos bigint,
  productos_total_centavos bigint,
  combos_total_centavos bigint,
  subtotal_centavos bigint,
  descuento_centavos bigint,
  cupon_id uuid,
  cupon_codigo text,
  cupon_porcentaje smallint,
  total_centavos bigint,
  credito_usado_centavos bigint,
  pago_otro_centavos bigint,
  medio_pago text,
  aviso_adulto boolean,
  comprador_email text,
  creada_en timestamptz,
  productos jsonb,
  combos jsonb,
  puntos_ganados bigint
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_pelicula public.peliculas%rowtype;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_precio_base integer := 800000;
  v_hash text;
  v_base record;
begin
  select p.* into v_pelicula
  from public.funciones f
  join public.peliculas p on p.id = f.pelicula_id
  where f.id = p_funcion_id and f.activa and p.visible_inicio;

  if not found then raise exception 'La función seleccionada no está disponible.'; end if;
  if v_hoy < v_pelicula.fecha_estreno then
    if not v_pelicula.preventa_habilitada
       or v_pelicula.precio_preventa_centavos is null
       or v_hoy < v_pelicula.fecha_estreno - 7 then
      raise exception 'La venta de entradas todavía no comenzó.';
    end if;
    v_precio_base := v_pelicula.precio_preventa_centavos;
  end if;

  v_hash := encode(digest(p_sesion_token::text, 'sha256'), 'hex');
  update public.reservas_butacas r
  set precio_centavos = v_precio_base + case when r.tipo = 'vip' then 300000 else 0 end
  where r.funcion_id = p_funcion_id and r.fecha_funcion = p_fecha
    and r.sesion_hash = v_hash and r.estado = 'reservada'
    and r.butaca_codigo = any(coalesce(p_codigos, array[]::text[]));

  select * into v_base from public.confirmar_compra_sin_preventa(
    p_funcion_id, p_fecha, p_codigos, p_sesion_token, p_email,
    p_fecha_nacimiento, p_usar_credito, p_medio_pago, p_productos,
    p_combos, p_cupon_id
  );

  return query select
    v_base.compra_id, v_base.compra_codigo, v_base.compra_qr_token,
    v_base.entradas_total_centavos, v_base.productos_total_centavos,
    v_base.combos_total_centavos, v_base.subtotal_centavos,
    v_base.descuento_centavos, v_base.cupon_id, v_base.cupon_codigo,
    v_base.cupon_porcentaje, v_base.total_centavos,
    v_base.credito_usado_centavos, v_base.pago_otro_centavos,
    v_base.medio_pago, v_base.aviso_adulto, v_base.comprador_email,
    v_base.creada_en, v_base.productos, v_base.combos,
    v_base.puntos_ganados;
end;
$$;

grant select on public.peliculas_con_ventas, public.funciones_detalle to anon, authenticated;
revoke all on public.alertas_peliculas from anon, authenticated;
grant select, insert, delete on public.alertas_peliculas to authenticated;
grant update (vista_en) on public.alertas_peliculas to authenticated;
revoke all on public.mis_peliculas from anon, authenticated;
grant select on public.mis_peliculas to authenticated;

revoke all on function public.mis_alertas_peliculas() from public;
grant execute on function public.mis_alertas_peliculas() to authenticated;
revoke all on function public.sincronizar_reserva_butacas_sin_preventa(uuid, date, text[], uuid) from public, anon, authenticated;
revoke all on function public.sincronizar_reserva_butacas(uuid, date, text[], uuid) from public;
grant execute on function public.sincronizar_reserva_butacas(uuid, date, text[], uuid) to anon, authenticated;
revoke all on function public.confirmar_compra_sin_preventa(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) from public;
grant execute on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) to anon, authenticated;
