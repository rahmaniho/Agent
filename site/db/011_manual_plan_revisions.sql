-- Additive manual plan revisions. NOT applied to production by this file.
-- A plan is data, not an approved workflow or a completed/started run.
create table public.studio_manual_plan_revisions (
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null check (revision between 1 and 200),
  project_version integer not null check (project_version > 0),
  tasks jsonb not null check (jsonb_typeof(tasks)='array' and octet_length(tasks::text)<=64000),
  created_at timestamptz not null default now(),
  primary key (project_id, revision)
);
create index studio_manual_plan_owner_project_revision on public.studio_manual_plan_revisions(user_id,project_id,revision desc);
alter table public.studio_manual_plan_revisions enable row level security;
revoke all on public.studio_manual_plan_revisions from public, anon, authenticated;
create policy manual_plan_owner_select on public.studio_manual_plan_revisions for select to authenticated
  using ((select auth.uid())=user_id and exists (select 1 from public.studio_projects p where p.id=project_id and p.user_id=(select auth.uid())));
grant select on public.studio_manual_plan_revisions to authenticated;

-- Validate input again in the database: callers can invoke the RPC without the API.
create function public.studio_manual_plan_tasks_valid(tasks jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; dep jsonb; task_id text; dependency text; title_text text; title_units integer; pos integer;
  ids text[] := '{}'; visited text[] := '{}'; dependencies text[]; is_ready boolean; advanced boolean;
begin
  if tasks is null or pg_catalog.jsonb_typeof(tasks) is distinct from 'array' or pg_catalog.octet_length(tasks::text)>64000 then return false; end if;
  if pg_catalog.jsonb_array_length(tasks) not between 1 and 100 then return false; end if;
  for item in select value from pg_catalog.jsonb_array_elements(tasks) loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object' then return false; end if;
    if exists(select 1 from pg_catalog.jsonb_object_keys(item) k where k not in ('id','title','weight','depends_on')) then return false; end if;
    if pg_catalog.jsonb_typeof(item->'id') is distinct from 'string' then return false; end if;
    task_id := item->>'id';
    if task_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or task_id=any(ids) then return false; end if;
    if pg_catalog.jsonb_typeof(item->'title') is distinct from 'string' then return false; end if;
    title_text := item->>'title'; title_units := pg_catalog.char_length(title_text);
    if title_units>200 or pg_catalog.btrim(title_text, E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' then return false; end if;
    -- JavaScript's string.length counts supplementary code points as two UTF-16 units.
    for pos in 1..pg_catalog.char_length(title_text) loop
      if pg_catalog.octet_length(pg_catalog.substr(title_text,pos,1))=4 then title_units := title_units+1; end if;
    end loop;
    if title_units>200 then return false; end if;
    if pg_catalog.jsonb_typeof(item->'weight') is distinct from 'number' or (item->>'weight') !~ '^([1-9][0-9]{0,2}|1000)$' then return false; end if;
    if pg_catalog.jsonb_typeof(item->'depends_on') is distinct from 'array' then return false; end if;
    if pg_catalog.jsonb_array_length(item->'depends_on')>50 then return false; end if;
    dependencies := '{}';
    for dep in select value from pg_catalog.jsonb_array_elements(item->'depends_on') loop
      if pg_catalog.jsonb_typeof(dep) is distinct from 'string' then return false; end if;
      dependency := dep #>> '{}';
      if dependency !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or dependency=any(dependencies) or dependency=task_id then return false; end if;
      dependencies := pg_catalog.array_append(dependencies,dependency);
    end loop;
    ids := pg_catalog.array_append(ids,task_id);
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(tasks) loop
    for dep in select value from pg_catalog.jsonb_array_elements(item->'depends_on') loop
      if not (dep #>> '{}')=any(ids) then return false; end if;
    end loop;
  end loop;
  -- Bounded Kahn traversal. No SQL or actions are derived from task text.
  while pg_catalog.cardinality(visited)<pg_catalog.cardinality(ids) loop
    advanced := false;
    for item in select value from pg_catalog.jsonb_array_elements(tasks) loop
      task_id := item->>'id';
      if task_id=any(visited) then continue; end if;
      is_ready := true;
      for dep in select value from pg_catalog.jsonb_array_elements(item->'depends_on') loop
        if not (dep #>> '{}')=any(visited) then is_ready := false; exit; end if;
      end loop;
      if is_ready then visited := pg_catalog.array_append(visited,task_id); advanced := true; end if;
    end loop;
    if not advanced then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.studio_manual_plan_tasks_valid(jsonb) from public, anon, authenticated;

-- Locks the owner project row, rechecks its version, then compares the latest plan
-- revision and inserts a new immutable revision in the same transaction.
create function public.studio_save_manual_plan(target_project uuid, expected_project_version integer, expected_revision integer, tasks jsonb)
returns table(applied boolean, reason text, revision integer, project_version integer, created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); current_project_version integer; current_revision integer; saved_at timestamptz;
begin
  if actor is null then raise exception 'Access denied' using errcode='42501'; end if;
  if target_project is null or expected_project_version is null or expected_project_version<1 or expected_revision is null or expected_revision<0 then
    raise exception 'Invalid request' using errcode='22023';
  end if;
  select p.version into current_project_version from public.studio_projects p where p.id=target_project and p.user_id=actor for update;
  if not found then return query select false,'not_found'::text,null::integer,null::integer,null::timestamptz; return; end if;
  if current_project_version<>expected_project_version then return query select false,'project_version_conflict'::text,null::integer,null::integer,null::timestamptz; return; end if;
  if not public.studio_manual_plan_tasks_valid(tasks) then raise exception 'Invalid plan' using errcode='22023'; end if;
  select coalesce(max(r.revision),0) into current_revision from public.studio_manual_plan_revisions r where r.project_id=target_project;
  if current_revision<>expected_revision then return query select false,'plan_revision_conflict'::text,null::integer,null::integer,null::timestamptz; return; end if;
  if current_revision>=200 then return query select false,'revision_limit'::text,null::integer,null::integer,null::timestamptz; return; end if;
  insert into public.studio_manual_plan_revisions as r(project_id,user_id,revision,project_version,tasks)
    values(target_project,actor,current_revision+1,current_project_version,tasks) returning r.created_at into saved_at;
  return query select true,'saved'::text,current_revision+1,current_project_version,saved_at;
end $$;
revoke all on function public.studio_save_manual_plan(uuid,integer,integer,jsonb) from public, anon;
grant execute on function public.studio_save_manual_plan(uuid,integer,integer,jsonb) to authenticated;
