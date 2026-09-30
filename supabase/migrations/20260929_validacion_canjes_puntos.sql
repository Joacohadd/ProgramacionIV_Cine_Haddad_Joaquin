-- Validación de recompensas por administradores y empleados.
alter table public.canjes_recompensas
  add column if not exists entregado_en timestamptz,
  add column if not exists entregado_por uuid references public.perfiles(id) on delete set null;

create index if not exists canjes_recompensas_creado_idx
  on public.canjes_recompensas (creado_en desc);

-- La consulta y la confirmación comparten una puerta de acceso controlada por rol.
-- FOR UPDATE impide que dos personas validen el mismo código al mismo tiempo.
create or replace function public.gestionar_canje_puntos_personal(
  p_codigo text, p_confirmar boolean default false
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_canje public.canjes_recompensas%rowtype;
  v_email text;
begin
  if not exists (
    select 1 from public.perfiles p
    where p.id = v_actor and p.rol in ('empleado', 'admin')
  ) then
    raise exception 'Solo el personal del cine puede validar canjes.';
  end if;
  if v_codigo !~ '^CAN-[A-Z0-9]{10}$' then
    raise exception 'Ingresá un código con formato CAN-XXXXXXXXXX.';
  end if;

  if coalesce(p_confirmar, false) then
    select c.* into v_canje from public.canjes_recompensas c
    where c.codigo = v_codigo for update;
  else
    select c.* into v_canje from public.canjes_recompensas c
    where c.codigo = v_codigo;
  end if;
  if not found then raise exception 'No se encontró un canje con ese código.'; end if;

  if coalesce(p_confirmar, false) then
    if v_canje.entregado_en is not null then
      raise exception 'Este código ya fue validado y no puede usarse otra vez.';
    end if;
    update public.canjes_recompensas c
    set entregado_en = now(), entregado_por = v_actor
    where c.id = v_canje.id returning c.* into v_canje;

    insert into public.auditoria_actividad
      (usuario_id, usuario_email, accion, entidad, entidad_id, detalle)
    select v_actor, p.email, 'canje_validado', 'canjes_recompensas',
      v_canje.id::text,
      jsonb_build_object('codigo', v_canje.codigo, 'tipo', v_canje.tipo,
        'recompensa', v_canje.recompensa_nombre)
    from public.perfiles p where p.id = v_actor;
  end if;

  select p.email into v_email from public.perfiles p where p.id = v_canje.usuario_id;
  return jsonb_build_object(
    'id', v_canje.id, 'codigo', v_canje.codigo,
    'usuario_email', v_email,
    'recompensa_nombre', v_canje.recompensa_nombre,
    'recompensa_descripcion', v_canje.recompensa_descripcion,
    'tipo', v_canje.tipo, 'producto_nombre', v_canje.producto_nombre,
    'costo_puntos', v_canje.costo_puntos,
    'creado_en', v_canje.creado_en, 'entregado_en', v_canje.entregado_en
  );
end;
$$;
revoke all on function public.gestionar_canje_puntos_personal(text, boolean) from public;
grant execute on function public.gestionar_canje_puntos_personal(text, boolean) to authenticated;

create or replace function public.listar_canjes_puntos_personal()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_resultado jsonb;
begin
  if not exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol in ('empleado', 'admin')
  ) then
    raise exception 'Solo el personal del cine puede consultar canjes.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'codigo', c.codigo,
    'usuario_email', p.email,
    'recompensa_nombre', c.recompensa_nombre,
    'recompensa_descripcion', c.recompensa_descripcion,
    'tipo', c.tipo, 'producto_nombre', c.producto_nombre,
    'costo_puntos', c.costo_puntos,
    'creado_en', c.creado_en, 'entregado_en', c.entregado_en
  ) order by c.creado_en desc), '[]'::jsonb)
  into v_resultado
  from (
    select * from public.canjes_recompensas
    order by creado_en desc limit 50
  ) c
  join public.perfiles p on p.id = c.usuario_id;
  return v_resultado;
end;
$$;
revoke all on function public.listar_canjes_puntos_personal() from public;
grant execute on function public.listar_canjes_puntos_personal() to authenticated;
