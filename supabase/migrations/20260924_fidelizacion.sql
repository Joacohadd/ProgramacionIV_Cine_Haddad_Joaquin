-- Punto 4.9: acumulación de puntos, recompensas e historial de canjes.

alter table public.perfiles alter column puntos type bigint;

create table if not exists public.recompensas_fidelizacion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) between 2 and 100),
  descripcion text not null check (char_length(trim(descripcion)) between 5 and 300),
  tipo text not null check (tipo in ('entrada', 'producto')),
  producto_id uuid references public.productos_candy(id) on delete restrict,
  costo_puntos bigint not null check (costo_puntos > 0),
  activo boolean not null default true,
  creada_en timestamptz not null default now(),
  constraint recompensas_producto_tipo_check check (
    (tipo = 'entrada' and producto_id is null)
    or (tipo = 'producto' and producto_id is not null)
  )
);

create table if not exists public.canjes_recompensas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^CAN-[A-Z0-9]{10}$'),
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  recompensa_id uuid not null references public.recompensas_fidelizacion(id) on delete restrict,
  recompensa_nombre text not null,
  recompensa_descripcion text not null,
  tipo text not null check (tipo in ('entrada', 'producto')),
  producto_id uuid references public.productos_candy(id) on delete restrict,
  producto_nombre text,
  costo_puntos bigint not null check (costo_puntos > 0),
  creado_en timestamptz not null default now()
);

insert into public.recompensas_fidelizacion (
  id, nombre, descripcion, tipo, producto_id, costo_puntos, activo
) values (
  'e1000000-0000-4000-8000-000000000001', 'Entrada gratis',
  'Canjeá tus puntos por una entrada general sin cargo.', 'entrada', null, 500, true
) on conflict (id) do nothing;

alter table public.recompensas_fidelizacion enable row level security;
alter table public.canjes_recompensas enable row level security;

drop policy if exists "recompensas: activas o admin" on public.recompensas_fidelizacion;
create policy "recompensas: activas o admin" on public.recompensas_fidelizacion
for select to authenticated using (activo or public.es_admin());
drop policy if exists "recompensas: alta admin" on public.recompensas_fidelizacion;
create policy "recompensas: alta admin" on public.recompensas_fidelizacion
for insert to authenticated with check (public.es_admin());
drop policy if exists "recompensas: edicion admin" on public.recompensas_fidelizacion;
create policy "recompensas: edicion admin" on public.recompensas_fidelizacion
for update to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists "canjes: lectura propia" on public.canjes_recompensas;
create policy "canjes: lectura propia" on public.canjes_recompensas
for select to authenticated using (usuario_id = auth.uid());

alter table public.compras add column if not exists puntos_ganados bigint not null default 0;
alter table public.compras drop constraint if exists compras_puntos_ganados_check;
alter table public.compras add constraint compras_puntos_ganados_check check (puntos_ganados >= 0);

-- La función del punto 4.8 conserva la compra y los cupones. Esta envoltura
-- acredita los puntos sobre el total final luego de aplicar el descuento.
do $$
begin
  if to_regprocedure('public.confirmar_compra(uuid,date,text[],uuid,text,date,boolean,text,jsonb,jsonb,uuid)') is not null
     and to_regprocedure('public.confirmar_compra_sin_puntos(uuid,date,text[],uuid,text,date,boolean,text,jsonb,jsonb,uuid)') is null then
    execute 'alter function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) rename to confirmar_compra_sin_puntos';
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
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_base record;
  v_puntos bigint := 0;
begin
  select * into v_base from public.confirmar_compra_sin_puntos(
    p_funcion_id, p_fecha, p_codigos, p_sesion_token, p_email,
    p_fecha_nacimiento, p_usar_credito, p_medio_pago, p_productos,
    p_combos, p_cupon_id
  );

  if v_usuario is not null then
    v_puntos := v_base.total_centavos / 100;
    update public.perfiles set puntos = puntos + v_puntos where id = v_usuario;
    update public.compras set puntos_ganados = v_puntos where id = v_base.compra_id;
  end if;

  return query select
    v_base.compra_id, v_base.compra_codigo, v_base.compra_qr_token,
    v_base.entradas_total_centavos, v_base.productos_total_centavos,
    v_base.combos_total_centavos, v_base.subtotal_centavos,
    v_base.descuento_centavos, v_base.cupon_id, v_base.cupon_codigo,
    v_base.cupon_porcentaje, v_base.total_centavos,
    v_base.credito_usado_centavos, v_base.pago_otro_centavos,
    v_base.medio_pago, v_base.aviso_adulto, v_base.comprador_email,
    v_base.creada_en, v_base.productos, v_base.combos, v_puntos;
end;
$$;

-- Si se cancela una compra se revierte su acreditación. Cuando esos puntos ya
-- fueron usados, la cancelación se bloquea para no producir un saldo negativo.
do $$
begin
  if to_regprocedure('public.cancelar_compra(uuid)') is not null
     and to_regprocedure('public.cancelar_compra_sin_puntos(uuid)') is null then
    execute 'alter function public.cancelar_compra(uuid) rename to cancelar_compra_sin_puntos';
  end if;
end;
$$;

drop function if exists public.cancelar_compra(uuid);
create function public.cancelar_compra(p_compra_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_compra public.compras%rowtype;
  v_puntos bigint;
  v_credito bigint;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para cancelar una compra.'; end if;

  select c.* into v_compra from public.compras c
  where c.id = p_compra_id and c.usuario_id = auth.uid() for update;
  if not found then raise exception 'La compra no pertenece a tu cuenta.'; end if;

  v_credito := public.cancelar_compra_sin_puntos(p_compra_id);
  update public.perfiles p set puntos = p.puntos - v_compra.puntos_ganados
  where p.id = auth.uid() and p.puntos >= v_compra.puntos_ganados
  returning p.puntos into v_puntos;
  if not found then
    raise exception 'No podés cancelar porque ya utilizaste los puntos obtenidos con esta compra.';
  end if;
  return v_credito;
end;
$$;

create or replace function public.canjear_recompensa(p_recompensa_id uuid)
returns table (
  id uuid,
  codigo text,
  recompensa_id uuid,
  recompensa_nombre text,
  recompensa_descripcion text,
  tipo text,
  producto_id uuid,
  producto_nombre text,
  costo_puntos bigint,
  creado_en timestamptz,
  puntos_restantes bigint
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_recompensa public.recompensas_fidelizacion%rowtype;
  v_canje public.canjes_recompensas%rowtype;
  v_producto_nombre text;
  v_puntos bigint;
begin
  if v_usuario is null then raise exception 'Iniciá sesión para canjear una recompensa.'; end if;

  select p.puntos into v_puntos from public.perfiles p where p.id = v_usuario for update;
  if not found then raise exception 'No se encontró el perfil de la cuenta.'; end if;

  select r.* into v_recompensa from public.recompensas_fidelizacion r
  where r.id = p_recompensa_id and r.activo for key share;
  if not found then raise exception 'La recompensa ya no está disponible.'; end if;

  if v_recompensa.tipo = 'producto' then
    select p.nombre into v_producto_nombre from public.productos_candy p
    where p.id = v_recompensa.producto_id and p.activo for key share;
    if not found then raise exception 'El producto asociado ya no está disponible.'; end if;
  end if;

  if v_puntos < v_recompensa.costo_puntos then
    raise exception 'No tenés puntos suficientes para esta recompensa.';
  end if;

  update public.perfiles p set puntos = p.puntos - v_recompensa.costo_puntos
  where p.id = v_usuario returning p.puntos into v_puntos;

  insert into public.canjes_recompensas (
    codigo, usuario_id, recompensa_id, recompensa_nombre,
    recompensa_descripcion, tipo, producto_id, producto_nombre, costo_puntos
  ) values (
    'CAN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_usuario, v_recompensa.id, v_recompensa.nombre,
    v_recompensa.descripcion, v_recompensa.tipo, v_recompensa.producto_id,
    v_producto_nombre, v_recompensa.costo_puntos
  ) returning * into v_canje;

  return query select
    v_canje.id, v_canje.codigo, v_canje.recompensa_id,
    v_canje.recompensa_nombre, v_canje.recompensa_descripcion,
    v_canje.tipo, v_canje.producto_id, v_canje.producto_nombre,
    v_canje.costo_puntos, v_canje.creado_en, v_puntos;
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
       c.descuento_centavos, c.cupon_id, c.cupon_codigo, c.cupon_porcentaje,
       c.puntos_ganados
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

revoke all on public.recompensas_fidelizacion from anon, authenticated;
grant select, insert, update on public.recompensas_fidelizacion to authenticated;
revoke all on public.canjes_recompensas from anon, authenticated;
grant select on public.canjes_recompensas to authenticated;
grant select on public.compras_detalle to authenticated;

revoke all on function public.confirmar_compra_sin_puntos(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) from public;
grant execute on function public.confirmar_compra(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid) to anon, authenticated;
revoke all on function public.cancelar_compra_sin_puntos(uuid) from public, anon, authenticated;
revoke all on function public.cancelar_compra(uuid) from public;
grant execute on function public.cancelar_compra(uuid) to authenticated;
revoke all on function public.canjear_recompensa(uuid) from public;
grant execute on function public.canjear_recompensa(uuid) to authenticated;
