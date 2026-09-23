-- Punto 4.8: cupones de primera compra y beneficios para mayores de 50.

create table if not exists public.cupones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo = upper(codigo) and codigo ~ '^[A-Z0-9_-]{4,24}$'),
  nombre text not null check (char_length(trim(nombre)) between 2 and 100),
  tipo text not null check (tipo in ('primera_compra', 'mayores_50')),
  porcentaje smallint not null check (porcentaje between 1 and 99),
  activo boolean not null default true,
  creada_en timestamptz not null default now()
);

create unique index if not exists cupones_una_primera_compra_idx
on public.cupones (tipo) where tipo = 'primera_compra';

insert into public.cupones (id, codigo, nombre, tipo, porcentaje, activo)
values ('d1000000-0000-4000-8000-000000000001', 'PRIMERA20', 'Primera compra', 'primera_compra', 20, true)
on conflict (id) do nothing;

alter table public.cupones enable row level security;
drop policy if exists "cupones: lectura admin" on public.cupones;
create policy "cupones: lectura admin" on public.cupones
for select to authenticated using (public.es_admin());
drop policy if exists "cupones: alta admin" on public.cupones;
create policy "cupones: alta admin" on public.cupones
for insert to authenticated with check (public.es_admin() and tipo = 'mayores_50');
drop policy if exists "cupones: edicion admin" on public.cupones;
create policy "cupones: edicion admin" on public.cupones
for update to authenticated using (public.es_admin()) with check (public.es_admin());

alter table public.compras
  add column if not exists descuento_centavos bigint not null default 0,
  add column if not exists cupon_id uuid references public.cupones(id) on delete restrict,
  add column if not exists cupon_codigo text,
  add column if not exists cupon_porcentaje smallint;

alter table public.compras drop constraint if exists compras_desglose_total_check;
alter table public.compras add constraint compras_desglose_total_check
  check (total_centavos + descuento_centavos = entradas_total_centavos + productos_total_centavos + combos_total_centavos);
alter table public.compras drop constraint if exists compras_descuento_check;
alter table public.compras add constraint compras_descuento_check check (
  descuento_centavos >= 0 and (
    (cupon_id is null and cupon_codigo is null and cupon_porcentaje is null and descuento_centavos = 0)
    or
    (cupon_id is not null and cupon_codigo is not null and cupon_porcentaje between 1 and 99)
  )
);

create or replace function public.cupones_disponibles()
returns table (id uuid, codigo text, nombre text, tipo text, porcentaje smallint, activo boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_nacimiento date;
begin
  if v_usuario is null then raise exception 'Iniciá sesión para consultar tus cupones.'; end if;
  select p.fecha_nacimiento into v_nacimiento from public.perfiles p where p.id = v_usuario;
  if not found then raise exception 'No se encontró el perfil de la cuenta.'; end if;

  return query
  select c.id, c.codigo, c.nombre, c.tipo, c.porcentaje, c.activo
  from public.cupones c
  where c.activo and (
    (c.tipo = 'primera_compra' and not exists (
      select 1 from public.compras co where co.usuario_id = v_usuario
    ))
    or
    (c.tipo = 'mayores_50' and extract(year from age(current_date, v_nacimiento)) > 50)
  )
  order by c.tipo, c.nombre;
end;
$$;

-- Se conserva la función del punto 4.7 como núcleo de la operación y se agrega
-- una envoltura que valida el cupón dentro de la misma transacción.
do $$
begin
  if to_regprocedure('public.confirmar_compra(uuid,date,text[],uuid,text,date,boolean,text,jsonb,jsonb)') is not null
     and to_regprocedure('public.confirmar_compra_sin_cupon(uuid,date,text[],uuid,text,date,boolean,text,jsonb,jsonb)') is null then
    execute 'alter function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb) rename to confirmar_compra_sin_cupon';
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
  combos jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_nacimiento date;
  v_cupon public.cupones%rowtype;
  v_base record;
  v_subtotal bigint;
  v_descuento bigint := 0;
  v_total bigint;
  v_credito bigint;
  v_otro bigint;
  v_medio text;
begin
  if p_cupon_id is not null then
    if v_usuario is null then raise exception 'Iniciá sesión para usar un cupón.'; end if;

    select p.fecha_nacimiento into v_nacimiento
    from public.perfiles p where p.id = v_usuario for update;
    if not found then raise exception 'No se encontró el perfil de la cuenta.'; end if;

    select c.* into v_cupon from public.cupones c
    where c.id = p_cupon_id and c.activo for key share;
    if not found then raise exception 'El cupón no está disponible.'; end if;

    if v_cupon.tipo = 'primera_compra' and exists (
      select 1 from public.compras co where co.usuario_id = v_usuario
    ) then raise exception 'El cupón de primera compra ya no está disponible.'; end if;

    if v_cupon.tipo = 'mayores_50'
       and extract(year from age(current_date, v_nacimiento)) <= 50 then
      raise exception 'Este cupón es exclusivo para usuarios mayores de 50 años.';
    end if;
  end if;

  select * into v_base from public.confirmar_compra_sin_cupon(
    p_funcion_id, p_fecha, p_codigos, p_sesion_token, p_email,
    p_fecha_nacimiento, p_usar_credito, p_medio_pago, p_productos, p_combos
  );

  v_subtotal := v_base.total_centavos;
  if p_cupon_id is not null then
    v_descuento := (v_subtotal * v_cupon.porcentaje) / 100;
  end if;
  v_total := v_subtotal - v_descuento;
  v_credito := least(v_base.credito_usado_centavos, v_total);
  v_otro := v_total - v_credito;
  v_medio := case when v_otro = 0 then 'credito' else v_base.medio_pago end;

  if v_base.credito_usado_centavos > v_credito then
    update public.perfiles
    set credito_centavos = credito_centavos + (v_base.credito_usado_centavos - v_credito)
    where id = v_usuario;
  end if;

  update public.compras set
    descuento_centavos = v_descuento,
    cupon_id = case when p_cupon_id is null then null else v_cupon.id end,
    cupon_codigo = case when p_cupon_id is null then null else v_cupon.codigo end,
    cupon_porcentaje = case when p_cupon_id is null then null else v_cupon.porcentaje end,
    total_centavos = v_total,
    credito_usado_centavos = v_credito,
    pago_otro_centavos = v_otro,
    medio_pago = v_medio
  where id = v_base.compra_id;

  return query select
    v_base.compra_id, v_base.compra_codigo, v_base.compra_qr_token,
    v_base.entradas_total_centavos, v_base.productos_total_centavos,
    v_base.combos_total_centavos, v_subtotal, v_descuento,
    case when p_cupon_id is null then null else v_cupon.id end,
    case when p_cupon_id is null then null else v_cupon.codigo end,
    case when p_cupon_id is null then null else v_cupon.porcentaje end,
    v_total, v_credito, v_otro, v_medio, v_base.aviso_adulto,
    v_base.comprador_email, v_base.creada_en, v_base.productos, v_base.combos;
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
       c.candy_retirado_en,
       c.total_centavos + c.descuento_centavos as subtotal_centavos,
       c.descuento_centavos, c.cupon_id, c.cupon_codigo, c.cupon_porcentaje
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

revoke all on public.cupones from anon, authenticated;
grant select, insert, update on public.cupones to authenticated;
grant select on public.compras_detalle to authenticated;

revoke all on function public.cupones_disponibles() from public;
grant execute on function public.cupones_disponibles() to authenticated;
revoke all on function public.confirmar_compra_sin_cupon(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) from public;
grant execute on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) to anon, authenticated;
