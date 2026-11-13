-- Stable pagination for the administrator's complete request queue.
create index studio_purchase_requests_created_id_idx on public.studio_purchase_requests(created_at desc, id desc);
create index studio_purchase_requests_status_created_id_idx on public.studio_purchase_requests(status, created_at desc, id desc);
create function public.studio_admin_purchases_v3(filter_status text, page_offset integer)
returns table(id bigint,user_id uuid,email text,payment_reference text,payer_email text,paid_at timestamptz,amount_toman integer,status text,created_at timestamptz,review_note text,rejection_reason text)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501'; end if;
  if filter_status is null or filter_status not in ('all','pending','approved','rejected') or page_offset is null or page_offset < 0 then raise exception 'Invalid pagination'; end if;
  return query select p.id,p.user_id,u.email::text,p.payment_reference,p.payer_email,p.paid_at,p.amount_toman,p.status,p.created_at,p.review_note,p.rejection_reason
    from public.studio_purchase_requests p join auth.users u on u.id=p.user_id
    where filter_status='all' or p.status=filter_status order by p.created_at desc,p.id desc limit 50 offset page_offset;
end $$;
revoke all on function public.studio_admin_purchases_v3(text,integer) from public,anon;
grant execute on function public.studio_admin_purchases_v3(text,integer) to authenticated;
