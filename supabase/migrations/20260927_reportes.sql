-- Punto 4.12: reportes de ventas y películas para administradores.

create index if not exists compras_estado_creada_idx
  on public.compras (estado, creada_en);
create index if not exists compras_estado_funcion_fecha_idx
  on public.compras (estado, fecha_funcion, funcion_id);

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
    'codigo', c.codigo, 'creada_en', c.creada_en, 'pelicula', p.titulo,
    'entradas', e.cantidad, 'total_centavos', c.total_centavos
  ) order by c.creada_en desc), '[]'::jsonb)
  into v_ventas
  from public.compras c
  join public.funciones f on f.id = c.funcion_id
  join public.peliculas p on p.id = f.pelicula_id
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
