-- Store manual card-transfer details; payment is never automatically verified.
-- Existing requests retain NULL payer_email/paid_at and remain reviewable.
alter table public.studio_purchase_requests
  add column payer_email text,
  add column paid_at timestamptz,
  add column amount_toman integer not null default 990000 check (amount_toman > 0);

drop function public.studio_submit_purchase(text);
drop function public.studio_my_purchases();
drop function public.studio_admin_purchases();

create function public.studio_submit_purchase(reference text, payer_email text, paid_at timestamptz)
returns bigint language plpgsql security definer set search_path = '' as $$
declare result bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if reference is null or char_length(btrim(reference)) not between 2 and 120 then raise exception 'Invalid reference'; end if;
  if payer_email is null or char_length(btrim(payer_email)) > 254 or btrim(payer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Invalid payer email'; end if;
  if paid_at is null or not isfinite(paid_at) or paid_at > now() + interval '5 minutes' then raise exception 'Invalid payment time'; end if;
  insert into public.studio_purchase_requests(user_id,payment_reference,payer_email,paid_at,amount_toman)
    values(auth.uid(),btrim(reference),lower(btrim(payer_email)),paid_at,990000) returning id into result;
  return result;
end $$;

create function public.studio_my_purchases()
returns table (id bigint, payment_reference text, payer_email text, paid_at timestamptz, amount_toman integer, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id,p.payment_reference,p.payer_email,p.paid_at,p.amount_toman,p.status,p.created_at
    from public.studio_purchase_requests p where p.user_id = auth.uid() order by p.created_at desc limit 20;
$$;

create function public.studio_admin_purchases()
returns table (id bigint, user_id uuid, email text, payment_reference text, payer_email text, paid_at timestamptz, amount_toman integer, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id = auth.uid()) then raise exception 'Access denied' using errcode = '42501'; end if;
  return query select p.id,p.user_id,u.email::text,p.payment_reference,p.payer_email,p.paid_at,p.amount_toman,p.status,p.created_at
    from public.studio_purchase_requests p join auth.users u on u.id=p.user_id where p.status='pending' order by p.created_at asc limit 500;
end $$;
revoke all on function public.studio_submit_purchase(text,text,timestamptz),public.studio_my_purchases(),public.studio_admin_purchases() from public, anon;
grant execute on function public.studio_submit_purchase(text,text,timestamptz),public.studio_my_purchases(),public.studio_admin_purchases() to authenticated;
