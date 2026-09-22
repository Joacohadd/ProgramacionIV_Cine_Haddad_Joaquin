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
