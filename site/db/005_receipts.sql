-- Receipts are private, limited to images, and visible only to their owner and administrators.
-- Existing three-argument purchase RPC remains available to older deployed clients.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-payment-receipts', 'studio-payment-receipts', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

alter table public.studio_purchase_requests add column receipt_path text unique;
create table public.studio_receipt_uploads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  object_name text not null unique,
  created_at timestamptz not null default now()
);
alter table public.studio_receipt_uploads enable row level security;
revoke all on public.studio_receipt_uploads from public, anon, authenticated;

create function public.studio_prepare_receipt() returns text
language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if exists (select 1 from public.studio_purchase_requests p where p.user_id=auth.uid() and p.status='pending') then
    raise exception 'Pending request already exists' using errcode = '23505';
  end if;
  insert into public.studio_receipt_uploads(user_id,object_name)
    values(auth.uid(),auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text)
    on conflict (user_id) do update set user_id=excluded.user_id
    returning object_name into result;
  return result;
end $$;

create function public.studio_receipt_upload_allowed(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.studio_receipt_uploads t where t.user_id=auth.uid() and t.object_name=$1)
    and not exists (select 1 from public.studio_purchase_requests p where p.receipt_path=$1);
$$;
create function public.studio_receipt_read_allowed(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists(select 1 from public.studio_receipt_uploads t where t.user_id=auth.uid() and t.object_name=$1)
    or exists(select 1 from public.studio_purchase_requests p where p.receipt_path=$1 and (p.user_id=auth.uid() or exists(select 1 from public.studio_admins a where a.user_id=auth.uid())))
  );
$$;
revoke all on function public.studio_prepare_receipt(), public.studio_receipt_upload_allowed(text), public.studio_receipt_read_allowed(text) from public, anon;
grant execute on function public.studio_prepare_receipt(), public.studio_receipt_upload_allowed(text), public.studio_receipt_read_allowed(text) to authenticated;
create policy "receipt upload by owner" on storage.objects for insert to authenticated
  with check (bucket_id='studio-payment-receipts' and public.studio_receipt_upload_allowed(name));
create policy "receipt read by owner or admin" on storage.objects for select to authenticated
  using (bucket_id='studio-payment-receipts' and public.studio_receipt_read_allowed(name));
create policy "remove unsubmitted receipt" on storage.objects for delete to authenticated
  using (bucket_id='studio-payment-receipts' and public.studio_receipt_upload_allowed(name));

create function public.studio_submit_purchase_with_receipt(reference text, payer_email text, paid_at timestamptz, receipt text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare result bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if reference is null or char_length(btrim(reference)) not between 2 and 120 then raise exception 'Invalid reference'; end if;
  if payer_email is null or char_length(btrim(payer_email)) > 254 or btrim(payer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Invalid payer email'; end if;
  if paid_at is null or not isfinite(paid_at) or paid_at > now() + interval '5 minutes' then raise exception 'Invalid payment time'; end if;
  perform 1 from public.studio_receipt_uploads t where t.user_id=auth.uid() and t.object_name=receipt for update;
  if not found or not exists(select 1 from storage.objects o where o.bucket_id='studio-payment-receipts' and o.name=receipt and o.owner_id=auth.uid()::text) then
    raise exception 'Receipt upload required';
  end if;
  insert into public.studio_purchase_requests(user_id,payment_reference,payer_email,paid_at,amount_toman,receipt_path)
    values(auth.uid(),btrim(reference),lower(btrim(payer_email)),paid_at,990000,receipt) returning id into result;
  delete from public.studio_receipt_uploads t where t.user_id=auth.uid();
  return result;
end $$;
revoke all on function public.studio_submit_purchase_with_receipt(text,text,timestamptz,text) from public, anon;
grant execute on function public.studio_submit_purchase_with_receipt(text,text,timestamptz,text) to authenticated;

-- Separate endpoint avoids changing the return type of the existing admin RPC.
create function public.studio_admin_receipt(request_id bigint) returns text
language plpgsql stable security definer set search_path = '' as $$
declare result text;
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id=auth.uid()) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select p.receipt_path into result from public.studio_purchase_requests p where p.id=request_id;
  return result;
end $$;
revoke all on function public.studio_admin_receipt(bigint) from public, anon;
grant execute on function public.studio_admin_receipt(bigint) to authenticated;
