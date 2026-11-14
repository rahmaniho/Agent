-- Add idempotent retry for manual plan revisions. NOT applied to production.
-- Depends on 011. Existing revisions retain NULL operation_id and cannot be replayed.
alter table public.studio_manual_plan_revisions add column operation_id uuid;
create unique index studio_manual_plan_project_operation on public.studio_manual_plan_revisions(project_id, operation_id) where operation_id is not null;

-- Remove the non-idempotent entry point. No CASCADE: unexpected dependencies should stop migration.
drop function public.studio_save_manual_plan(uuid,integer,integer,jsonb);

create function public.studio_save_manual_plan(target_project uuid, expected_project_version integer, expected_revision integer, tasks jsonb, operation_id uuid)
returns table(applied boolean, reason text, revision integer, project_version integer, created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); current_project_version integer; current_revision integer; saved_at timestamptz;
  prior public.studio_manual_plan_revisions%rowtype;
begin
  if actor is null then raise exception 'Access denied' using errcode='42501'; end if;
  if target_project is null or expected_project_version is null or expected_project_version<1 or
     expected_revision is null or expected_revision<0 or expected_revision>200 or operation_id is null then
    raise exception 'Invalid request' using errcode='22023';
  end if;
  -- Project lock serializes fresh requests, replays, and project changes.
  select p.version into current_project_version from public.studio_projects p where p.id=target_project and p.user_id=actor for update;
  if not found then return query select false,'not_found'::text,null::integer,null::integer,null::timestamptz; return; end if;
  if not public.studio_manual_plan_tasks_valid(tasks) then raise exception 'Invalid plan' using errcode='22023'; end if;
  select r.* into prior from public.studio_manual_plan_revisions r
    where r.project_id=target_project and r.operation_id=studio_save_manual_plan.operation_id;
  if found then
    if prior.user_id<>actor or prior.project_version<>expected_project_version or prior.revision<>expected_revision+1 or prior.tasks is distinct from tasks then
      return query select false,'idempotency_key_conflict'::text,null::integer,null::integer,null::timestamptz; return;
    end if;
    return query select true,'replayed'::text,prior.revision,prior.project_version,prior.created_at; return;
  end if;
  if current_project_version<>expected_project_version then return query select false,'project_version_conflict'::text,null::integer,null::integer,null::timestamptz; return; end if;
  select coalesce(max(r.revision),0) into current_revision from public.studio_manual_plan_revisions r where r.project_id=target_project;
  if current_revision<>expected_revision then return query select false,'plan_revision_conflict'::text,null::integer,null::integer,null::timestamptz; return; end if;
  if current_revision>=200 then return query select false,'revision_limit'::text,null::integer,null::integer,null::timestamptz; return; end if;
  insert into public.studio_manual_plan_revisions as r(project_id,user_id,revision,project_version,tasks,operation_id)
    values(target_project,actor,current_revision+1,current_project_version,tasks,studio_save_manual_plan.operation_id) returning r.created_at into saved_at;
  return query select true,'saved'::text,current_revision+1,current_project_version,saved_at;
end $$;
revoke all on function public.studio_save_manual_plan(uuid,integer,integer,jsonb,uuid) from public, anon;
grant execute on function public.studio_save_manual_plan(uuid,integer,integer,jsonb,uuid) to authenticated;
