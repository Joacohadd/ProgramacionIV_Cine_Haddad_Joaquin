-- Punto 4.11: acceso del personal, validación y actividad administrativa.

alter table public.compras
  add column if not exists ingreso_validado_en timestamptz,
  add column if not exists ingreso_validado_por uuid references public.perfiles(id) on delete set null;

create table if not exists public.auditoria_actividad (
  id bigint generated always as identity primary key,
  usuario_id uuid references public.perfiles(id) on delete set null,
  usuario_email text not null,
  accion text not null,
  entidad text not null,
  entidad_id text,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists auditoria_actividad_fecha_idx
  on public.auditoria_actividad (creado_en desc);

alter table public.auditoria_actividad enable row level security;
drop policy if exists "auditoria: lectura admin" on public.auditoria_actividad;
create policy "auditoria: lectura admin" on public.auditoria_actividad
  for select to authenticated using (public.es_admin());
revoke all on public.auditoria_actividad from anon, authenticated;
grant select on public.auditoria_actividad to authenticated;

-- Se registra desde la base para incluir cambios efectuados desde cualquier
-- cliente y conservar fecha, actor y datos de la operación.
create or replace function public.registrar_actividad_cine()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_usuario uuid := auth.uid();
  v_email text;
  v_accion text;
  v_detalle jsonb := '{}'::jsonb;
  v_entidad_id text;
  v_modo text := coalesce(nullif(current_setting('app.umbral_modo_validacion', true), ''), 'qr');
begin
  select p.email into v_email from public.perfiles p where p.id = v_usuario;
  v_email := coalesce(v_email, 'sistema');

  if tg_table_name = 'compras' then
    if old.ingreso_validado_en is null and new.ingreso_validado_en is not null then
      insert into public.auditoria_actividad (usuario_id, usuario_email, accion, entidad, entidad_id, detalle)
      values (v_usuario, v_email, 'ingreso_validado', 'compras', new.id::text,
              jsonb_build_object('codigo', new.codigo, 'medio', v_modo));
    end if;
    if old.candy_retirado_en is null and new.candy_retirado_en is not null then
      insert into public.auditoria_actividad (usuario_id, usuario_email, accion, entidad, entidad_id, detalle)
      values (v_usuario, v_email, 'candy_entregado', 'compras', new.id::text,
              jsonb_build_object('codigo', new.codigo, 'medio', v_modo));
    end if;
    return null;
  end if;

  if tg_table_name = 'funciones' then
    v_entidad_id := case when tg_op = 'DELETE' then old.id::text else new.id::text end;
    v_accion := case tg_op
      when 'INSERT' then 'funcion_creada'
      when 'DELETE' then 'funcion_eliminada'
      else 'funcion_modificada' end;
    v_detalle := case when tg_op = 'DELETE' then
      jsonb_build_object('pelicula_id', old.pelicula_id, 'sala_id', old.sala_id)
    else jsonb_build_object('pelicula_id', new.pelicula_id, 'sala_id', new.sala_id,
         'fecha_desde', new.fecha_desde, 'fecha_hasta', new.fecha_hasta,
         'hora_inicio', new.hora_inicio, 'formato', new.formato) end;
  elsif tg_table_name = 'peliculas' then
    if tg_op = 'UPDATE' and (
      old.preventa_habilitada is distinct from new.preventa_habilitada
      or old.precio_preventa_centavos is distinct from new.precio_preventa_centavos
    ) then
      v_accion := 'precio_preventa_modificado';
      v_entidad_id := new.id::text;
      v_detalle := jsonb_build_object(
        'titulo', new.titulo, 'precio_anterior', old.precio_preventa_centavos,
        'precio_nuevo', new.precio_preventa_centavos,
        'preventa_habilitada', new.preventa_habilitada);
    end if;
  elsif tg_table_name in ('productos_candy', 'combos_candy') then
    if tg_op = 'UPDATE' and old.precio_centavos is distinct from new.precio_centavos then
      v_accion := 'precio_modificado';
      v_entidad_id := new.id::text;
      v_detalle := jsonb_build_object(
        'nombre', new.nombre, 'precio_anterior', old.precio_centavos,
        'precio_nuevo', new.precio_centavos);
    end if;
  elsif tg_table_name = 'perfiles' then
    if tg_op = 'UPDATE' and old.rol is distinct from new.rol then
      v_accion := 'rol_modificado';
      v_entidad_id := new.id::text;
      v_detalle := jsonb_build_object(
        'email', new.email, 'rol_anterior', old.rol, 'rol_nuevo', new.rol);
    end if;
  end if;

  if v_accion is not null then
    insert into public.auditoria_actividad (usuario_id, usuario_email, accion, entidad, entidad_id, detalle)
    values (v_usuario, v_email, v_accion, tg_table_name, v_entidad_id, v_detalle);
  end if;
  return null;
end;
$$;

drop trigger if exists auditar_funciones on public.funciones;
create trigger auditar_funciones after insert or update or delete on public.funciones
for each row execute function public.registrar_actividad_cine();

drop trigger if exists auditar_precios_peliculas on public.peliculas;
create trigger auditar_precios_peliculas after update on public.peliculas
for each row execute function public.registrar_actividad_cine();

drop trigger if exists auditar_precios_productos on public.productos_candy;
create trigger auditar_precios_productos after update on public.productos_candy
for each row execute function public.registrar_actividad_cine();

drop trigger if exists auditar_precios_combos on public.combos_candy;
create trigger auditar_precios_combos after update on public.combos_candy
for each row execute function public.registrar_actividad_cine();

drop trigger if exists auditar_roles on public.perfiles;
create trigger auditar_roles after update of rol on public.perfiles
for each row execute function public.registrar_actividad_cine();

drop trigger if exists auditar_validaciones on public.compras;
create trigger auditar_validaciones after update of ingreso_validado_en, candy_retirado_en on public.compras
for each row execute function public.registrar_actividad_cine();

revoke all on function public.registrar_actividad_cine() from public, anon, authenticated;

-- El administrador convierte cuentas registradas en cuentas de empleado.
-- No se entregan credenciales ni privilegios de administración desde el navegador.
create or replace function public.asignar_rol_empleado(p_usuario_id uuid, p_es_empleado boolean)
returns text language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_rol text;
  v_nuevo text := case when p_es_empleado then 'empleado' else 'cliente' end;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede asignar empleados.';
  end if;
  select p.rol into v_rol from public.perfiles p where p.id = p_usuario_id for update;
  if not found then raise exception 'La cuenta no existe.'; end if;
  if v_rol = 'admin' then raise exception 'No se puede modificar otra cuenta administradora.'; end if;
  update public.perfiles set rol = v_nuevo where id = p_usuario_id;
  return v_nuevo;
end;
$$;
revoke all on function public.asignar_rol_empleado(uuid, boolean) from public;
grant execute on function public.asignar_rol_empleado(uuid, boolean) to authenticated;

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
  select c.estado = 'pagada', c.estado, c.codigo, p.titulo, c.fecha_funcion,
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
  join public.funciones f on f.id = c.funcion_id
  join public.peliculas p on p.id = f.pelicula_id
  join public.salas s on s.id = f.sala_id
  where c.codigo = upper(trim(p_codigo))
    and (p_qr_token is null or c.qr_token = p_qr_token);
end;
$$;
revoke all on function public.consultar_compra_personal(text, uuid) from public;
grant execute on function public.consultar_compra_personal(text, uuid) to authenticated;

-- Una operación consume solamente su uso: ingreso y candy se validan por separado.
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

-- Una compra con ingreso registrado no puede ser reintegrada posteriormente.
do $$
begin
  if to_regprocedure('public.cancelar_compra(uuid)') is not null
     and to_regprocedure('public.cancelar_compra_sin_ingreso(uuid)') is null then
    execute 'alter function public.cancelar_compra(uuid) rename to cancelar_compra_sin_ingreso';
  end if;
end;
$$;

drop function if exists public.cancelar_compra(uuid);
create function public.cancelar_compra(p_compra_id uuid)
returns bigint language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_compra public.compras%rowtype;
begin
  select c.* into v_compra from public.compras c
  where c.id = p_compra_id and c.usuario_id = auth.uid() for update;
  if not found then raise exception 'La compra no pertenece a tu cuenta.'; end if;
  if v_compra.ingreso_validado_en is not null then
    raise exception 'La entrada ya fue utilizada y no puede cancelarse.';
  end if;
  return public.cancelar_compra_sin_ingreso(p_compra_id);
end;
$$;
revoke all on function public.cancelar_compra_sin_ingreso(uuid) from public, anon, authenticated;
revoke all on function public.cancelar_compra(uuid) from public;
grant execute on function public.cancelar_compra(uuid) to authenticated;

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
       c.puntos_ganados, c.ingreso_validado_en
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

grant select on public.compras_detalle to authenticated;
