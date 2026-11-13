-- Manual subscriptions. No administrator is provisioned by this migration.
create table public.studio_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.studio_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus')),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((plan = 'free' and expires_at is null) or (plan = 'plus' and expires_at is not null))
);
alter table public.studio_admins enable row level security;
alter table public.studio_subscriptions enable row level security;
revoke all on public.studio_admins, public.studio_subscriptions from anon, authenticated;

-- All access is through narrowly scoped functions, not editable browser metadata.
create function public.studio_my_account()
returns table (is_admin boolean, plan text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.studio_admins a where a.user_id = auth.uid()),
    case when s.plan = 'plus' and s.expires_at > now() then 'plus' else 'free' end,
    s.expires_at
  from (select auth.uid() as id) me left join public.studio_subscriptions s on s.user_id = me.id
  where me.id is not null;
$$;
create function public.studio_admin_users()
returns table (user_id uuid, email text, created_at timestamptz, plan text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins where studio_admins.user_id = auth.uid()) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return query select u.id, u.email::text, u.created_at, coalesce(s.plan, 'free'), s.expires_at
    from auth.users u left join public.studio_subscriptions s on s.user_id = u.id
    order by u.created_at desc limit 500;
end;
$$;
create function public.studio_set_subscription(target_user uuid, target_plan text, target_expiry timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins where studio_admins.user_id = auth.uid()) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if target_plan not in ('free', 'plus') or target_plan is null or
    (target_plan = 'free' and target_expiry is not null) or
    (target_plan = 'plus' and (target_expiry is null or target_expiry <= now())) then
    raise exception 'Invalid subscription';
  end if;
  insert into public.studio_subscriptions(user_id, plan, expires_at, updated_at)
    values (target_user, target_plan, target_expiry, now())
    on conflict (user_id) do update set plan = excluded.plan, expires_at = excluded.expires_at, updated_at = now();
end;
$$;
revoke all on function public.studio_my_account(), public.studio_admin_users(), public.studio_set_subscription(uuid,text,timestamptz) from public, anon;
grant execute on function public.studio_my_account(), public.studio_admin_users(), public.studio_set_subscription(uuid,text,timestamptz) to authenticated;
