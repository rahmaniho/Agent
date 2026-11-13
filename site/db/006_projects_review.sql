-- Cross-device projects and review metadata. The old RPCs remain compatible.
create table public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  project_type text not null check (char_length(project_type) between 1 and 80),
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=50 and octet_length(checklist::text)<=16000),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index studio_projects_owner_updated on public.studio_projects(user_id,updated_at desc);
alter table public.studio_projects enable row level security;
revoke all on public.studio_projects from public, anon, authenticated;
create policy project_owner_select on public.studio_projects for select to authenticated using ((select auth.uid()) = user_id);
create policy project_owner_insert on public.studio_projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy project_owner_update on public.studio_projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy project_owner_delete on public.studio_projects for delete to authenticated using ((select auth.uid()) = user_id);
grant select,delete on public.studio_projects to authenticated;
grant insert(title,description,project_type,checklist) on public.studio_projects to authenticated;
grant update(title,description,project_type,checklist,version,updated_at) on public.studio_projects to authenticated;

alter table public.studio_purchase_requests add column review_note text check (char_length(review_note)<=2000), add column rejection_reason text check (char_length(rejection_reason)<=1000);
create table public.studio_subscription_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  previous_plan text,
  previous_expiry timestamptz,
  new_plan text not null,
  new_expiry timestamptz,
  changed_at timestamptz not null default now()
);
create index studio_subscription_history_user_changed on public.studio_subscription_history(user_id,changed_at desc);
alter table public.studio_subscription_history enable row level security;
revoke all on public.studio_subscription_history from public, anon, authenticated;
create function public.studio_log_subscription_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.studio_subscription_history(user_id,actor_id,previous_plan,previous_expiry,new_plan,new_expiry)
  values(new.user_id,auth.uid(),case when tg_op='UPDATE' then old.plan else null end,case when tg_op='UPDATE' then old.expires_at else null end,new.plan,new.expires_at);
  return new;
end $$;
create trigger studio_subscription_audit after insert or update of plan,expires_at on public.studio_subscriptions for each row execute function public.studio_log_subscription_change();
revoke all on function public.studio_log_subscription_change() from public, anon, authenticated;

create function public.studio_review_purchase_v2(request_id bigint, decision text, target_expiry timestamptz, note text, reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
  if length(coalesce(note,''))>2000 or length(coalesce(reason,''))>1000 or (decision='rejected' and length(btrim(coalesce(reason,'')))=0) then raise exception 'Invalid review details'; end if;
  perform public.studio_review_purchase(request_id,decision,target_expiry);
  update public.studio_purchase_requests p set review_note=nullif(btrim(note),''), rejection_reason=case when decision='rejected' then nullif(btrim(reason),'') else null end where p.id=request_id;
end $$;
create function public.studio_my_purchases_v2() returns table(id bigint,payment_reference text,payer_email text,paid_at timestamptz,amount_toman integer,status text,created_at timestamptz,rejection_reason text)
language sql stable security definer set search_path='' as $$
  select p.id,p.payment_reference,p.payer_email,p.paid_at,p.amount_toman,p.status,p.created_at,p.rejection_reason from public.studio_purchase_requests p where p.user_id=auth.uid() order by p.created_at desc limit 20;
$$;
create function public.studio_admin_purchases_v2(filter_status text) returns table(id bigint,user_id uuid,email text,payment_reference text,payer_email text,paid_at timestamptz,amount_toman integer,status text,created_at timestamptz,review_note text,rejection_reason text)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
  if filter_status not in ('all','pending','approved','rejected') or filter_status is null then raise exception 'Invalid status'; end if;
  return query select p.id,p.user_id,u.email::text,p.payment_reference,p.payer_email,p.paid_at,p.amount_toman,p.status,p.created_at,p.review_note,p.rejection_reason from public.studio_purchase_requests p join auth.users u on u.id=p.user_id where filter_status='all' or p.status=filter_status order by p.created_at desc limit 500;
end $$;
create function public.studio_admin_subscription_history(target_user uuid) returns table(previous_plan text,previous_expiry timestamptz,new_plan text,new_expiry timestamptz,changed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
  return query select h.previous_plan,h.previous_expiry,h.new_plan,h.new_expiry,h.changed_at from public.studio_subscription_history h where h.user_id=target_user order by h.changed_at desc limit 100;
end $$;
revoke all on function public.studio_review_purchase_v2(bigint,text,timestamptz,text,text),public.studio_my_purchases_v2(),public.studio_admin_purchases_v2(text),public.studio_admin_subscription_history(uuid) from public,anon;
grant execute on function public.studio_review_purchase_v2(bigint,text,timestamptz,text,text),public.studio_my_purchases_v2(),public.studio_admin_purchases_v2(text),public.studio_admin_subscription_history(uuid) to authenticated;
