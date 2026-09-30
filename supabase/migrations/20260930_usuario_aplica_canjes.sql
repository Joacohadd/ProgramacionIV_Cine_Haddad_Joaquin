-- Los premios reclamados con puntos se aplican durante la compra del cliente.
alter table public.compras
  drop constraint if exists compras_total_centavos_check;
alter table public.compras
  add constraint compras_total_centavos_check check (total_centavos >= 0);
alter table public.compras
  add column if not exists recompensas_descuento_centavos bigint not null default 0;
alter table public.compras drop constraint if exists compras_desglose_total_check;
alter table public.compras add constraint compras_desglose_total_check check (
  total_centavos + descuento_centavos + recompensas_descuento_centavos
    = entradas_total_centavos + productos_total_centavos + combos_total_centavos
  and recompensas_descuento_centavos >= 0
);

alter table public.canjes_recompensas
  add column if not exists compra_id uuid references public.compras(id) on delete restrict,
  add column if not exists compra_codigo text;
create index if not exists canjes_recompensas_compra_idx on public.canjes_recompensas(compra_id);

-- Se retira la confirmación manual previa. El personal solo consulta el estado.
revoke all on function public.gestionar_canje_puntos_personal(text, boolean) from public, anon, authenticated;
create or replace function public.consultar_canje_puntos_personal(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_resultado jsonb;
begin
  if not exists (select 1 from public.perfiles where id = auth.uid() and rol in ('empleado', 'admin')) then
    raise exception 'Solo el personal del cine puede consultar canjes.';
  end if;
  if upper(trim(coalesce(p_codigo, ''))) !~ '^CAN-[A-Z0-9]{10}$' then
    raise exception 'Ingresá un código con formato CAN-XXXXXXXXXX.';
  end if;
  select jsonb_build_object(
    'id', c.id, 'codigo', c.codigo, 'usuario_email', p.email,
    'recompensa_nombre', c.recompensa_nombre, 'recompensa_descripcion', c.recompensa_descripcion,
    'tipo', c.tipo, 'producto_nombre', c.producto_nombre, 'costo_puntos', c.costo_puntos,
    'creado_en', c.creado_en, 'entregado_en', c.entregado_en, 'compra_codigo', c.compra_codigo
  ) into v_resultado from public.canjes_recompensas c
  join public.perfiles p on p.id = c.usuario_id
  where c.codigo = upper(trim(p_codigo));
  if v_resultado is null then raise exception 'No se encontró un canje con ese código.'; end if;
  return v_resultado;
end;
$$;
revoke all on function public.consultar_canje_puntos_personal(text) from public;
grant execute on function public.consultar_canje_puntos_personal(text) to authenticated;

create or replace function public.listar_canjes_puntos_personal()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_resultado jsonb;
begin
  if not exists (select 1 from public.perfiles where id = auth.uid() and rol in ('empleado', 'admin')) then
    raise exception 'Solo el personal del cine puede consultar canjes.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'codigo', c.codigo, 'usuario_email', p.email,
    'recompensa_nombre', c.recompensa_nombre, 'recompensa_descripcion', c.recompensa_descripcion,
    'tipo', c.tipo, 'producto_nombre', c.producto_nombre, 'costo_puntos', c.costo_puntos,
    'creado_en', c.creado_en, 'entregado_en', c.entregado_en, 'compra_codigo', c.compra_codigo
  ) order by c.creado_en desc), '[]'::jsonb) into v_resultado
  from (select * from public.canjes_recompensas order by creado_en desc limit 50) c
  join public.perfiles p on p.id = c.usuario_id;
  return v_resultado;
end;
$$;

-- Función interna: valida propiedad, disponibilidad y límites; aplica todo en una transacción.
create or replace function public.aplicar_canjes_compra(
  p_compra_id uuid, p_canjes text[], p_productos jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compra public.compras%rowtype;
  v_canje public.canjes_recompensas%rowtype;
  v_codigo text;
  v_codigos text[];
  v_usos jsonb := '{}'::jsonb;
  v_usados integer;
  v_cantidad integer;
  v_precio bigint;
  v_entradas_gratis integer := 0;
  v_combo_cantidad integer := 0;
  v_entradas_elegibles integer;
  v_descuento bigint := 0;
  v_total bigint;
  v_credito bigint;
  v_puntos bigint;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para usar premios de puntos.'; end if;
  if p_canjes is null or cardinality(p_canjes) = 0 or cardinality(p_canjes) > 30 then
    raise exception 'Elegí entre 1 y 30 premios de puntos.';
  end if;
  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found or v_compra.usuario_id is distinct from auth.uid() or v_compra.estado <> 'pagada' then
    raise exception 'La compra no pertenece a tu cuenta o no está activa.';
  end if;
  if v_compra.cupon_id is not null then raise exception 'Los premios de puntos no se combinan con cupones.'; end if;
  if v_compra.recompensas_descuento_centavos <> 0 then raise exception 'Los premios ya se aplicaron a esta compra.'; end if;
  select array_agg(distinct codigo order by codigo) into v_codigos from unnest(p_canjes) codigo;
  if cardinality(v_codigos) <> cardinality(p_canjes)
     or exists (select 1 from unnest(p_canjes) codigo where codigo is null or codigo !~ '^CAN-[A-Z0-9]{10}$') then
    raise exception 'La lista de premios contiene códigos repetidos o inválidos.';
  end if;
  select coalesce(sum(cc.cantidad), 0)::integer into v_combo_cantidad
  from public.compra_combos cc where cc.compra_id = p_compra_id;

  foreach v_codigo in array v_codigos loop
    select * into v_canje from public.canjes_recompensas
    where codigo = v_codigo for update;
    if not found or v_canje.usuario_id <> auth.uid() or v_canje.entregado_en is not null then
      raise exception 'Uno de los premios ya fue usado o no pertenece a tu cuenta.';
    end if;
    if v_canje.tipo = 'entrada' then
      v_entradas_gratis := v_entradas_gratis + 1;
    else
      if v_canje.producto_id is null then raise exception 'El premio no tiene producto asociado.'; end if;
      v_usados := coalesce((v_usos ->> v_canje.producto_id::text)::integer, 0) + 1;
      select coalesce(sum((item ->> 'cantidad')::integer), 0) into v_cantidad
      from jsonb_array_elements(coalesce(p_productos, '[]'::jsonb)) item
      where item ->> 'producto_id' = v_canje.producto_id::text;
      if v_cantidad < v_usados then raise exception 'Agregá el producto del premio al pedido.'; end if;
      select cp.precio_unitario_centavos into v_precio from public.compra_productos cp
      where cp.compra_id = p_compra_id and cp.producto_id = v_canje.producto_id;
      if v_precio is null then raise exception 'El producto del premio no figura en la compra.'; end if;
      v_descuento := v_descuento + v_precio;
      v_usos := jsonb_set(v_usos, array[v_canje.producto_id::text], to_jsonb(v_usados));
    end if;
  end loop;

  if v_entradas_gratis > 0 then
    select count(*)::integer, coalesce(sum(precio_centavos), 0)
    into v_entradas_elegibles, v_precio
    from (
      select precio_centavos from (
        select e.precio_centavos, e.tipo, e.butaca_codigo,
          row_number() over (order by e.precio_centavos, e.butaca_codigo) as posicion
        from public.entradas e where e.compra_id = p_compra_id
      ) ordenadas
      where posicion > v_combo_cantidad and tipo in ('estandar', 'accesible')
      order by precio_centavos, butaca_codigo limit v_entradas_gratis
    ) elegidas;
    if v_entradas_elegibles < v_entradas_gratis then
      raise exception 'La entrada gratis requiere una butaca general o accesible fuera de los combos.';
    end if;
    v_descuento := v_descuento + v_precio;
  end if;

  if v_descuento > v_compra.total_centavos then raise exception 'El valor de los premios supera el total de la compra.'; end if;
  v_total := v_compra.total_centavos - v_descuento;
  v_credito := least(v_compra.credito_usado_centavos, v_total);
  v_puntos := v_total / 100;
  update public.compras set
    recompensas_descuento_centavos = v_descuento,
    total_centavos = v_total,
    credito_usado_centavos = v_credito,
    pago_otro_centavos = v_total - v_credito,
    medio_pago = case when v_total = v_credito then 'credito' else v_compra.medio_pago end,
    puntos_ganados = v_puntos
  where id = p_compra_id;
  update public.perfiles set
    credito_centavos = credito_centavos + v_compra.credito_usado_centavos - v_credito,
    puntos = puntos - v_compra.puntos_ganados + v_puntos
  where id = auth.uid();
  update public.canjes_recompensas set
    entregado_en = now(), compra_id = p_compra_id, compra_codigo = v_compra.codigo
  where codigo = any(v_codigos);
  insert into public.auditoria_actividad
    (usuario_id, usuario_email, accion, entidad, entidad_id, detalle)
  select auth.uid(), p.email, 'canje_aplicado', 'canjes_recompensas', c.id::text,
    jsonb_build_object('codigo', c.codigo, 'compra_codigo', v_compra.codigo,
      'tipo', c.tipo, 'recompensa', c.recompensa_nombre)
  from public.canjes_recompensas c
  join public.perfiles p on p.id = c.usuario_id
  where c.codigo = any(v_codigos);
  return jsonb_build_object(
    'recompensas_descuento_centavos', v_descuento, 'canjes_aplicados', to_jsonb(v_codigos),
    'total_centavos', v_total, 'credito_usado_centavos', v_credito,
    'pago_otro_centavos', v_total - v_credito,
    'medio_pago', case when v_total = v_credito then 'credito' else v_compra.medio_pago end,
    'puntos_ganados', v_puntos
  );
end;
$$;
revoke all on function public.aplicar_canjes_compra(uuid, text[], jsonb) from public, anon, authenticated;

create or replace function public.confirmar_compra_con_canjes(
  p_funcion_id uuid, p_fecha date, p_codigos text[], p_sesion_token uuid,
  p_email text, p_fecha_nacimiento date, p_usar_credito boolean, p_medio_pago text,
  p_productos jsonb, p_combos jsonb, p_cupon_id uuid, p_canjes text[]
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base jsonb; v_ajuste jsonb;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para usar premios de puntos.'; end if;
  if p_cupon_id is not null then raise exception 'Los premios de puntos no se combinan con cupones.'; end if;
  select to_jsonb(base) into v_base from public.confirmar_compra(
    p_funcion_id, p_fecha, p_codigos, p_sesion_token, p_email, p_fecha_nacimiento,
    p_usar_credito, p_medio_pago, p_productos, p_combos, p_cupon_id
  ) base;
  if v_base is null then raise exception 'No se pudo confirmar la compra.'; end if;
  v_ajuste := public.aplicar_canjes_compra((v_base ->> 'compra_id')::uuid, p_canjes, p_productos);
  return v_base || v_ajuste;
end;
$$;
revoke all on function public.confirmar_compra_con_canjes(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid, text[]) from public;
grant execute on function public.confirmar_compra_con_canjes(uuid, date, text[], uuid, text, date, boolean, text, jsonb, jsonb, uuid, text[]) to authenticated;

create or replace function public.confirmar_compra_candy_con_canjes(
  p_email text, p_productos jsonb, p_usar_credito boolean, p_medio_pago text, p_canjes text[]
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base jsonb; v_ajuste jsonb;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para usar premios de puntos.'; end if;
  v_base := public.confirmar_compra_candy(p_email, p_productos, p_usar_credito, p_medio_pago);
  v_ajuste := public.aplicar_canjes_compra((v_base ->> 'compra_id')::uuid, p_canjes, p_productos);
  return v_base || v_ajuste;
end;
$$;
revoke all on function public.confirmar_compra_candy_con_canjes(text, jsonb, boolean, text, text[]) from public;
grant execute on function public.confirmar_compra_candy_con_canjes(text, jsonb, boolean, text, text[]) to authenticated;

-- Si una compra se cancela antes de usar el QR, el premio vuelve a estar disponible.
create or replace function public.restaurar_canjes_compra_cancelada()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.estado = 'pagada' and new.estado = 'cancelada' then
    update public.canjes_recompensas set entregado_en = null, compra_id = null, compra_codigo = null
    where compra_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists restaurar_canjes_compra_cancelada on public.compras;
create trigger restaurar_canjes_compra_cancelada
after update of estado on public.compras for each row
execute function public.restaurar_canjes_compra_cancelada();

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
       c.total_centavos + c.descuento_centavos + c.recompensas_descuento_centavos as subtotal_centavos,
       c.descuento_centavos, c.cupon_id, c.cupon_codigo, c.cupon_porcentaje,
       c.puntos_ganados, c.ingreso_validado_en,
       c.recompensas_descuento_centavos,
       coalesce(canjes.codigos, '[]'::jsonb) as canjes_aplicados
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
) combo_detalle on true
left join lateral (
  select jsonb_agg(cr.codigo order by cr.codigo) as codigos
  from public.canjes_recompensas cr where cr.compra_id = c.id
) canjes on true;

grant select on public.compras_detalle to authenticated;
