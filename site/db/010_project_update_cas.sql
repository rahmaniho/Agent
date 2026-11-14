-- Additive, compatible project-update RPC. NOT applied by this file.
-- Legacy direct UPDATE grants are intentionally unchanged for old clients.
-- Consequently this RPC does not yet force all clients to use CAS.
create function public.studio_update_project_cas(target_id uuid, expected_version integer, patch jsonb)
returns table(applied boolean, new_version integer, updated_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare actor uuid := auth.uid(); v_version integer; v_updated timestamptz;
begin
  if actor is null then raise exception 'Access denied' using errcode='42501'; end if;
  if target_id is null or expected_version is null or expected_version < 1 or patch is null
      or pg_catalog.jsonb_typeof(patch) is distinct from 'object' or patch='{}'::jsonb
      or pg_catalog.octet_length(patch::text)>40000 then
    raise exception 'Invalid update' using errcode='22023';
  end if;
  if exists(select 1 from pg_catalog.jsonb_object_keys(patch) k where k not in ('title','description','project_type','checklist')) then
    raise exception 'Invalid update' using errcode='22023';
  end if;
  if patch ? 'title' and (pg_catalog.jsonb_typeof(patch->'title') is distinct from 'string' or pg_catalog.char_length(pg_catalog.btrim(patch->>'title')) not between 1 and 120) then
    raise exception 'Invalid update' using errcode='22023';
  end if;
  if patch ? 'description' and (pg_catalog.jsonb_typeof(patch->'description') is distinct from 'string' or pg_catalog.char_length(patch->>'description') > 3000) then
    raise exception 'Invalid update' using errcode='22023';
  end if;
  if patch ? 'project_type' and (pg_catalog.jsonb_typeof(patch->'project_type') is distinct from 'string' or pg_catalog.char_length(patch->>'project_type') not between 1 and 80) then
    raise exception 'Invalid update' using errcode='22023';
  end if;
  if patch ? 'checklist' then
    if pg_catalog.jsonb_typeof(patch->'checklist') is distinct from 'array' then raise exception 'Invalid update' using errcode='22023'; end if;
    if pg_catalog.jsonb_array_length(patch->'checklist')>50 or pg_catalog.octet_length((patch->'checklist')::text)>16000 then raise exception 'Invalid update' using errcode='22023'; end if;
  end if;
  update public.studio_projects as p set
    title=case when patch ? 'title' then patch->>'title' else p.title end,
    description=case when patch ? 'description' then patch->>'description' else p.description end,
    project_type=case when patch ? 'project_type' then patch->>'project_type' else p.project_type end,
    checklist=case when patch ? 'checklist' then patch->'checklist' else p.checklist end,
    version=p.version+1, updated_at=pg_catalog.clock_timestamp()
  where p.id=target_id and p.user_id=actor and p.version=expected_version
  returning p.version,p.updated_at into v_version,v_updated;
  return query select v_version is not null,v_version,v_updated;
end $$;
revoke all on function public.studio_update_project_cas(uuid,integer,jsonb) from public, anon;
grant execute on function public.studio_update_project_cas(uuid,integer,jsonb) to authenticated;
