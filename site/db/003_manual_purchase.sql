-- Subscription-gated catalog and a manual purchase request queue.
-- Full catalog is populated separately with an administrative connection.
create table public.studio_catalog (
  id boolean primary key default true check (id),
  catalog jsonb not null,
  playbooks jsonb not null
);
alter table public.studio_catalog enable row level security;
revoke all on public.studio_catalog from public, anon, authenticated;

create table public.studio_purchase_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  payment_reference text not null check (char_length(payment_reference) between 2 and 120),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);
create unique index studio_one_pending_request on public.studio_purchase_requests(user_id) where status = 'pending';
alter table public.studio_purchase_requests enable row level security;
revoke all on public.studio_purchase_requests from public, anon, authenticated;

create function public.studio_premium_catalog()
returns table (catalog jsonb, playbooks jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    exists(select 1 from public.studio_admins a where a.user_id = auth.uid()) or
    exists(select 1 from public.studio_subscriptions s where s.user_id = auth.uid() and s.plan = 'plus' and s.expires_at > now())
  ) then raise exception 'Subscription required' using errcode = '42501'; end if;
  return query select c.catalog, c.playbooks from public.studio_catalog c where c.id = true;
end $$;
create function public.studio_submit_purchase(reference text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare result bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if reference is null or char_length(btrim(reference)) not between 2 and 120 then raise exception 'Invalid reference'; end if;
  insert into public.studio_purchase_requests(user_id,payment_reference) values(auth.uid(),btrim(reference)) returning id into result;
  return result;
end $$;
create function public.studio_my_purchases()
returns table (id bigint, payment_reference text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id,p.payment_reference,p.status,p.created_at from public.studio_purchase_requests p where p.user_id = auth.uid() order by p.created_at desc limit 20;
$$;
create function public.studio_admin_purchases()
returns table (id bigint, user_id uuid, email text, payment_reference text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id = auth.uid()) then raise exception 'Access denied' using errcode = '42501'; end if;
  return query select p.id,p.user_id,u.email::text,p.payment_reference,p.status,p.created_at from public.studio_purchase_requests p join auth.users u on u.id = p.user_id where p.status = 'pending' order by p.created_at asc limit 500;
end $$;
create function public.studio_review_purchase(request_id bigint, decision text, target_expiry timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare target_user uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id = auth.uid()) then raise exception 'Access denied' using errcode = '42501'; end if;
  if decision is null or decision not in ('approved','rejected') or (decision = 'approved' and (target_expiry is null or target_expiry <= now())) or (decision = 'rejected' and target_expiry is not null) then raise exception 'Invalid decision'; end if;
  select p.user_id into target_user from public.studio_purchase_requests p where p.id = request_id and p.status = 'pending' for update;
  if target_user is null then raise exception 'Request is no longer pending'; end if;
  if decision = 'approved' then
    insert into public.studio_subscriptions(user_id,plan,expires_at,updated_at) values (target_user,'plus',target_expiry,now())
    on conflict (user_id) do update set plan=excluded.plan,expires_at=excluded.expires_at,updated_at=now();
  end if;
  update public.studio_purchase_requests p set status=decision,reviewed_at=now(),reviewed_by=auth.uid() where p.id=request_id;
end $$;
revoke all on function public.studio_premium_catalog(),public.studio_submit_purchase(text),public.studio_my_purchases(),public.studio_admin_purchases(),public.studio_review_purchase(bigint,text,timestamptz) from public, anon;
grant execute on function public.studio_premium_catalog(),public.studio_submit_purchase(text),public.studio_my_purchases(),public.studio_admin_purchases(),public.studio_review_purchase(bigint,text,timestamptz) to authenticated;
