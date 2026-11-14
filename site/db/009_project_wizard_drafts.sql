-- Additive, opt-in project wizard drafts. NOT applied to production by this file.
-- One row per user, including tombstones, preserves a monotonic CAS revision.
create table public.studio_project_drafts (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  payload jsonb,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  check (payload is null or (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 64000))
);
alter table public.studio_project_drafts enable row level security;
revoke all on public.studio_project_drafts from public, anon, authenticated;
create policy project_draft_owner_select on public.studio_project_drafts for select to authenticated
  using ((select auth.uid()) = user_id);
grant select on public.studio_project_drafts to authenticated;

-- Validate only the known form fields; partial/empty fields are allowed for drafts.
create function public.studio_project_draft_valid(draft jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; need_count integer;
begin
  if draft is null or pg_catalog.jsonb_typeof(draft) <> 'object' or pg_catalog.octet_length(draft::text)>64000 then return false; end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(draft) k where k not in ('version','title','description','type','needs','plan','step')) then return false; end if;
  if (draft->'version') is distinct from '1'::jsonb then return false; end if;
  if pg_catalog.jsonb_typeof(draft->'title') is distinct from 'string' or pg_catalog.char_length(draft->>'title')>120 then return false; end if;
  if pg_catalog.jsonb_typeof(draft->'description') is distinct from 'string' or pg_catalog.char_length(draft->>'description')>3000 then return false; end if;
  if pg_catalog.jsonb_typeof(draft->'type') is distinct from 'string' or pg_catalog.char_length(draft->>'type') not between 1 and 80 then return false; end if;
  if pg_catalog.jsonb_typeof(draft->'needs') is distinct from 'array' then return false; end if;
  if pg_catalog.jsonb_array_length(draft->'needs')>4 then return false; end if;
  select count(distinct value) into need_count from pg_catalog.jsonb_array_elements(draft->'needs');
  if need_count<>pg_catalog.jsonb_array_length(draft->'needs') then return false; end if;
  for item in select value from pg_catalog.jsonb_array_elements(draft->'needs') loop
    if pg_catalog.jsonb_typeof(item) <> 'string' or item not in ('"accounts"'::jsonb,'"data"'::jsonb,'"design"'::jsonb,'"publish"'::jsonb) then return false; end if;
  end loop;
  if draft ? 'plan' and draft->'plan' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(draft->'plan') is distinct from 'array' then return false; end if;
    if pg_catalog.jsonb_array_length(draft->'plan')>50 then return false; end if;
    for item in select value from pg_catalog.jsonb_array_elements(draft->'plan') loop
      if pg_catalog.jsonb_typeof(item) <> 'string' or pg_catalog.char_length(item #>> '{}')>200 then return false; end if;
    end loop;
  end if;
  if draft ? 'step' and draft->'step' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb) then return false; end if;
  return true;
end $$;
revoke all on function public.studio_project_draft_valid(jsonb) from public, anon, authenticated;

-- An absent row has revision 0. Any other revision must match exactly.
-- A conflict returns false, never an implicit overwrite. No client-provided owner.
create function public.studio_save_project_draft(draft jsonb, expected_revision integer)
returns table(applied boolean, revision integer)
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); new_revision integer;
begin
  if actor is null then raise exception 'Access denied' using errcode='42501'; end if;
  if expected_revision is null or expected_revision < 0 or not public.studio_project_draft_valid(draft) then
    raise exception 'Invalid draft' using errcode='22023';
  end if;
  if expected_revision=0 then
    insert into public.studio_project_drafts as d (user_id,payload) values (actor,draft)
    on conflict (user_id) do nothing returning d.revision into new_revision;
  else
    update public.studio_project_drafts as d set payload=draft,revision=d.revision+1,updated_at=pg_catalog.now()
      where d.user_id=actor and d.revision=expected_revision returning d.revision into new_revision;
  end if;
  return query select new_revision is not null,new_revision;
end $$;

-- Logical deletion avoids ABA: a stale client cannot overwrite a re-created draft.
create function public.studio_delete_project_draft(expected_revision integer)
returns table(applied boolean, revision integer)
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); new_revision integer;
begin
  if actor is null then raise exception 'Access denied' using errcode='42501'; end if;
  if expected_revision is null or expected_revision < 1 then raise exception 'Invalid revision' using errcode='22023'; end if;
  update public.studio_project_drafts as d set payload=null,revision=d.revision+1,updated_at=pg_catalog.now()
    where d.user_id=actor and d.revision=expected_revision and d.payload is not null returning d.revision into new_revision;
  return query select new_revision is not null,new_revision;
end $$;
revoke all on function public.studio_save_project_draft(jsonb,integer), public.studio_delete_project_draft(integer) from public, anon;
grant execute on function public.studio_save_project_draft(jsonb,integer), public.studio_delete_project_draft(integer) to authenticated;
