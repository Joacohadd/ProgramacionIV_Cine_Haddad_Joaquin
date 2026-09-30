-- Corrige la referencia ambigua en la funcion de compra de entradas.
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
  update public.entradas e set aviso_adulto = v_aviso where e.compra_id = v_base.compra_id;

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
