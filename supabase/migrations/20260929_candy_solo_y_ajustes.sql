-- Compras de candy sin función, fila K fuera de venta y reportes diarios.
alter table public.compras alter column funcion_id drop not null;
alter table public.compras alter column fecha_funcion drop not null;
alter table public.compras drop constraint if exists compras_funcion_fecha_juntas;
alter table public.compras add constraint compras_funcion_fecha_juntas
  check ((funcion_id is null) = (fecha_funcion is null));

create or replace function public.rechazar_fila_k()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if split_part(new.butaca_codigo, '-', 1) = 'K' then
    raise exception 'La fila K ya no está disponible para reservar.';
  end if;
  return new;
end;
$$;
drop trigger if exists reservas_sin_fila_k on public.reservas_butacas;
create trigger reservas_sin_fila_k before insert or update of butaca_codigo
on public.reservas_butacas for each row execute function public.rechazar_fila_k();

create or replace function public.confirmar_compra_candy(
  p_email text, p_productos jsonb, p_usar_credito boolean, p_medio_pago text
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_usuario uuid := auth.uid();
  v_perfil public.perfiles%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_item jsonb;
  v_producto public.productos_candy%rowtype;
  v_cantidad integer;
  v_total bigint := 0;
  v_credito bigint := 0;
  v_puntos bigint := 0;
  v_compra public.compras%rowtype;
  v_productos jsonb;
  v_ids uuid[] := '{}';
begin
  if p_productos is null or jsonb_typeof(p_productos) <> 'array' then
    raise exception 'La selección de productos no es válida.';
  end if;
  if jsonb_array_length(p_productos) = 0 then
    raise exception 'Elegí al menos un producto del candy.';
  end if;
  if jsonb_array_length(p_productos) > 30 then
    raise exception 'La compra contiene demasiados productos.';
  end if;
  if p_medio_pago is null or p_medio_pago not in ('tarjeta_credito', 'tarjeta_debito', 'billetera_virtual') then
    raise exception 'Elegí un medio de pago válido.';
  end if;
  if v_usuario is not null then
    select * into v_perfil from public.perfiles where id = v_usuario for update;
    if not found then raise exception 'No se encontró tu perfil. Volvé a iniciar sesión.'; end if;
    v_email := v_perfil.email;
  elsif v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Ingresá un correo electrónico válido.';
  end if;

  for v_item in select value from jsonb_array_elements(p_productos) loop
    if coalesce(v_item->>'producto_id', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(v_item->>'cantidad', '') !~ '^[0-9]+$' then
      raise exception 'La selección de productos no es válida.';
    end if;
    v_cantidad := (v_item->>'cantidad')::integer;
    if v_cantidad < 1 or v_cantidad > 20 then raise exception 'Podés comprar hasta 20 unidades de cada producto.'; end if;
    if (v_item->>'producto_id')::uuid = any(v_ids) then raise exception 'Hay un producto repetido en la compra.'; end if;
    select * into v_producto from public.productos_candy
    where id = (v_item->>'producto_id')::uuid and activo = true for share;
    if not found then raise exception 'Uno de los productos ya no está disponible.'; end if;
    v_ids := array_append(v_ids, v_producto.id);
    v_total := v_total + v_producto.precio_centavos::bigint * v_cantidad;
  end loop;

  if v_usuario is not null and coalesce(p_usar_credito, false) then
    v_credito := least(v_perfil.credito_centavos, v_total);
  end if;
  v_puntos := case when v_usuario is not null then v_total / 100 else 0 end;
  insert into public.compras (
    codigo, usuario_id, comprador_email, funcion_id, fecha_funcion,
    entradas_total_centavos, productos_total_centavos, combos_total_centavos,
    total_centavos, credito_usado_centavos, pago_otro_centavos, medio_pago, puntos_ganados
  ) values (
    'UMB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_usuario, v_email, null, null,
    0, v_total, 0, v_total, v_credito, v_total - v_credito,
    case when v_credito = v_total then 'credito' else p_medio_pago end, v_puntos
  ) returning * into v_compra;

  for v_item in select value from jsonb_array_elements(p_productos) loop
    select * into v_producto from public.productos_candy where id = (v_item->>'producto_id')::uuid;
    insert into public.compra_productos (compra_id, producto_id, producto_nombre, cantidad, precio_unitario_centavos)
    values (v_compra.id, v_producto.id, v_producto.nombre, (v_item->>'cantidad')::integer, v_producto.precio_centavos);
  end loop;
  if v_usuario is not null then
    update public.perfiles set credito_centavos = credito_centavos - v_credito,
      puntos = puntos + v_puntos where id = v_usuario;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'producto_id', cp.producto_id, 'nombre', cp.producto_nombre,
    'cantidad', cp.cantidad, 'precio_unitario_centavos', cp.precio_unitario_centavos,
    'subtotal_centavos', cp.subtotal_centavos) order by cp.producto_nombre), '[]'::jsonb)
  into v_productos from public.compra_productos cp where cp.compra_id = v_compra.id;
  return jsonb_build_object(
    'compra_id', v_compra.id, 'compra_codigo', v_compra.codigo,
    'compra_qr_token', v_compra.qr_token, 'comprador_email', v_email,
    'productos_total_centavos', v_total, 'total_centavos', v_total,
    'credito_usado_centavos', v_credito, 'pago_otro_centavos', v_total - v_credito,
    'medio_pago', v_compra.medio_pago, 'puntos_ganados', v_puntos,
    'creada_en', v_compra.creada_en, 'productos', v_productos
  );
end;
$$;
revoke all on function public.confirmar_compra_candy(text, jsonb, boolean, text) from public;
grant execute on function public.confirmar_compra_candy(text, jsonb, boolean, text) to anon, authenticated;


-- Vistas, personal y reporte compatibles con pedidos sin función.
create or replace view public.compras_detalle with (security_invoker = true) as
select c.id, c.codigo, c.usuario_id, c.comprador_email, c.funcion_id,
       f.pelicula_id, coalesce(p.titulo, 'Solo candy') as pelicula_titulo, coalesce(s.nombre, '') as sala_nombre,
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
       c.puntos_ganados, c.ingreso_validado_en
from public.compras c
left join public.funciones f on f.id = c.funcion_id
left join public.peliculas p on p.id = f.pelicula_id
left join public.salas s on s.id = f.sala_id
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

grant select on public.compras_detalle to authenticated;

create or replace function public.consultar_compra_personal(
  p_codigo text, p_qr_token uuid default null
)
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
  ingreso_validado_en timestamptz,
  candy_retirado_en timestamptz
)
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol in ('empleado', 'admin')
  ) then raise exception 'Solo el personal del cine puede consultar compras.'; end if;

  return query
  select c.estado = 'pagada', c.estado, c.codigo, coalesce(p.titulo, 'Solo candy'), c.fecha_funcion,
         f.hora_inicio, s.nombre,
         array(select e.butaca_codigo from public.entradas e
               where e.compra_id = c.id order by e.butaca_codigo),
         coalesce((select jsonb_agg(jsonb_build_object(
           'producto_id', cp.producto_id, 'nombre', cp.producto_nombre,
           'cantidad', cp.cantidad, 'precio_unitario_centavos', cp.precio_unitario_centavos,
           'subtotal_centavos', cp.subtotal_centavos
         ) order by cp.producto_nombre)
         from public.compra_productos cp where cp.compra_id = c.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
           'combo_id', cc.combo_id, 'nombre', cc.combo_nombre,
           'cantidad', cc.cantidad, 'precio_unitario_centavos', cc.precio_unitario_centavos,
           'subtotal_centavos', cc.subtotal_centavos
         ) order by cc.combo_nombre)
         from public.compra_combos cc where cc.compra_id = c.id), '[]'::jsonb),
         c.ingreso_validado_en, c.candy_retirado_en
  from public.compras c
  left join public.funciones f on f.id = c.funcion_id
  left join public.peliculas p on p.id = f.pelicula_id
  left join public.salas s on s.id = f.sala_id
  where c.codigo = upper(trim(p_codigo))
    and (p_qr_token is null or c.qr_token = p_qr_token);
end;
$$;
revoke all on function public.consultar_compra_personal(text, uuid) from public;
grant execute on function public.consultar_compra_personal(text, uuid) to authenticated;

create or replace function public.reporte_ventas_admin(
  p_dia date, p_periodo text default 'semana'
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_inicio timestamptz;
  v_fin timestamptz;
  v_desde date;
  v_hasta date;
  v_facturacion bigint;
  v_entradas bigint;
  v_compras bigint;
  v_ventas jsonb;
  v_peliculas jsonb;
  v_producto jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede consultar reportes.';
  end if;
  if p_dia is null or p_periodo is null or p_periodo not in ('semana', 'mes') then
    raise exception 'Elegí una fecha y un período válidos.';
  end if;

  -- La facturación usa la fecha local de la venta, no la de la función.
  v_inicio := p_dia::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_fin := (p_dia + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_desde := date_trunc(case when p_periodo = 'semana' then 'week' else 'month' end,
                        p_dia::timestamp)::date;
  v_hasta := case when p_periodo = 'semana'
    then v_desde + 7
    else (v_desde + interval '1 month')::date end;

  select coalesce(sum(c.total_centavos), 0)::bigint,
         count(*)::bigint,
         coalesce(sum(e.cantidad), 0)::bigint
  into v_facturacion, v_compras, v_entradas
  from public.compras c
  left join lateral (
    select count(*)::bigint as cantidad from public.entradas
    where compra_id = c.id
  ) e on true
  where c.estado = 'pagada' and c.creada_en >= v_inicio and c.creada_en < v_fin;

  select coalesce(jsonb_agg(jsonb_build_object(
    'codigo', c.codigo, 'creada_en', c.creada_en, 'pelicula', coalesce(p.titulo, 'Solo candy'),
    'entradas', e.cantidad, 'total_centavos', c.total_centavos
  ) order by c.creada_en desc), '[]'::jsonb)
  into v_ventas
  from public.compras c
  left join public.funciones f on f.id = c.funcion_id
  left join public.peliculas p on p.id = f.pelicula_id
  left join lateral (
    select count(*)::bigint as cantidad from public.entradas
    where compra_id = c.id
  ) e on true
  where c.estado = 'pagada' and c.creada_en >= v_inicio and c.creada_en < v_fin;

  -- Las películas se agrupan por fecha de función; las compras canceladas no cuentan.
  select coalesce(jsonb_agg(jsonb_build_object(
    'pelicula_id', ranking.pelicula_id, 'titulo', ranking.titulo,
    'entradas', ranking.entradas
  ) order by ranking.entradas desc, ranking.titulo), '[]'::jsonb)
  into v_peliculas
  from (
    select p.id as pelicula_id, p.titulo, count(e.id)::bigint as entradas
    from public.compras c
    join public.entradas e on e.compra_id = c.id
    join public.funciones f on f.id = c.funcion_id
    join public.peliculas p on p.id = f.pelicula_id
    where c.estado = 'pagada'
      and c.fecha_funcion >= v_desde and c.fecha_funcion < v_hasta
    group by p.id, p.titulo
  ) ranking;

  -- compra_productos incluye los productos que forman parte de combos.
  select jsonb_build_object('producto_id', ranking.producto_id,
    'nombre', ranking.nombre, 'cantidad', ranking.cantidad)
  into v_producto
  from (
    select p.id as producto_id, p.nombre, sum(cp.cantidad)::bigint as cantidad
    from public.compra_productos cp
    join public.compras c on c.id = cp.compra_id and c.estado = 'pagada'
      and c.creada_en >= v_inicio and c.creada_en < v_fin
    join public.productos_candy p on p.id = cp.producto_id
    group by p.id, p.nombre
    order by cantidad desc, p.nombre
    limit 1
  ) ranking;

  return jsonb_build_object(
    'dia', p_dia, 'periodo', p_periodo,
    'periodo_desde', v_desde, 'periodo_hasta', v_hasta - 1,
    'facturacion_centavos', v_facturacion,
    'entradas_vendidas', v_entradas, 'compras', v_compras,
    'ventas', v_ventas, 'peliculas', v_peliculas,
    'producto_mas_vendido', v_producto
  );
end;
$$;

revoke all on function public.reporte_ventas_admin(date, text) from public;
grant execute on function public.reporte_ventas_admin(date, text) to authenticated;

-- Aviso de edad solo para quienes aún son menores.
create or replace function public.confirmar_compra(
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
  v_aviso boolean;
  v_nacimiento date;
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

  if exists (select 1 from unnest(p_codigos) codigo where split_part(codigo, '-', 1) = 'K') then
    raise exception 'La fila K ya no está disponible para comprar.';
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

  select fecha_nacimiento into v_nacimiento from public.perfiles where id = auth.uid();
  v_nacimiento := coalesce(v_nacimiento, p_fecha_nacimiento);
  v_aviso := v_pelicula.clasificacion <> 'ATP'
    and v_nacimiento is not null
    and age(p_fecha, v_nacimiento) < interval '18 years';
  update public.compras set aviso_adulto = v_aviso where id = v_base.compra_id;
  update public.entradas set aviso_adulto = v_aviso where compra_id = v_base.compra_id;

  return query select
    v_base.compra_id, v_base.compra_codigo, v_base.compra_qr_token,
    v_base.entradas_total_centavos, v_base.productos_total_centavos,
    v_base.combos_total_centavos, v_base.subtotal_centavos,
    v_base.descuento_centavos, v_base.cupon_id, v_base.cupon_codigo,
    v_base.cupon_porcentaje, v_base.total_centavos,
    v_base.credito_usado_centavos, v_base.pago_otro_centavos,
    v_base.medio_pago, v_aviso, v_base.comprador_email,
    v_base.creada_en, v_base.productos, v_base.combos,
    v_base.puntos_ganados;
end;
$$;


-- Un QR de solo candy no permite acceder a la sala.
create or replace function public.validar_operacion_personal(
  p_codigo text, p_operacion text, p_qr_token uuid default null
)
returns table (compra_codigo text, operacion text, validado_en timestamptz)
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_compra public.compras%rowtype;
  v_fecha timestamptz;
begin
  if not exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol in ('empleado', 'admin')
  ) then raise exception 'Solo el personal del cine puede validar compras.'; end if;
  if p_operacion is null or p_operacion not in ('ingreso', 'candy') then
    raise exception 'La operación solicitada no es válida.';
  end if;

  select c.* into v_compra from public.compras c
  where c.codigo = upper(trim(p_codigo))
    and (p_qr_token is null or c.qr_token = p_qr_token)
  for update;
  if not found then raise exception 'No se encontró una compra con ese código.'; end if;
  if v_compra.estado <> 'pagada' then raise exception 'La compra no está vigente.'; end if;

  perform set_config('app.umbral_modo_validacion',
    case when p_qr_token is null then 'manual' else 'qr' end, true);

  if p_operacion = 'ingreso' then
    if v_compra.funcion_id is null then
      raise exception 'El pedido no incluye entrada.';
    end if;
    if v_compra.ingreso_validado_en is not null then
      raise exception 'El ingreso de esta entrada ya fue validado.';
    end if;
    update public.compras c
    set ingreso_validado_en = now(), ingreso_validado_por = auth.uid()
    where c.id = v_compra.id returning c.ingreso_validado_en into v_fecha;
  else
    if v_compra.candy_retirado_en is not null then
      raise exception 'El candy de esta compra ya fue entregado.';
    end if;
    if not exists (
      select 1 from public.compra_productos cp where cp.compra_id = v_compra.id
    ) then raise exception 'La compra no contiene productos del candy.'; end if;
    update public.compras c
    set candy_retirado_en = now(), candy_retirado_por = auth.uid()
    where c.id = v_compra.id returning c.candy_retirado_en into v_fecha;
  end if;
  return query select v_compra.codigo, p_operacion, v_fecha;
end;
$$;
revoke all on function public.validar_operacion_personal(text, text, uuid) from public;
grant execute on function public.validar_operacion_personal(text, text, uuid) to authenticated;
