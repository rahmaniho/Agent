-- Admin-only editorial updates; content remains inside the protected catalog.
create table public.studio_catalog_review_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  item_name text not null,
  previous_description text,
  previous_level text,
  new_description text not null,
  new_level text not null,
  changed_at timestamptz not null default now()
);
alter table public.studio_catalog_review_audit enable row level security;
revoke all on public.studio_catalog_review_audit from public, anon, authenticated;

create function public.studio_admin_update_catalog_review(
  kind text, item_name text, description text, level text,
  previous_description text, previous_level text
) returns void language plpgsql security definer set search_path = '' as $$
declare catalog_snapshot jsonb; old_item jsonb; matches integer; new_items jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.studio_admins a where a.user_id=auth.uid()) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if kind is null or kind not in ('skills','commands','agents') or item_name is null or char_length(item_name) not between 1 and 200
    or description is null or char_length(btrim(description)) not between 1 and 1000
    or level is null or level not in ('unknown','beginner','advanced') then
    raise exception 'Invalid review';
  end if;
  select c.catalog into catalog_snapshot from public.studio_catalog c where c.id=true for update;
  if catalog_snapshot is null or jsonb_typeof(catalog_snapshot->kind) is distinct from 'array' then raise exception 'Catalog unavailable'; end if;
  select count(*), min(x.item::text)::jsonb into matches, old_item
    from jsonb_array_elements(catalog_snapshot->kind) x(item) where x.item->>'name'=item_name;
  if matches <> 1 then raise exception 'Catalog item not found or ambiguous'; end if;
  if old_item->>'description_fa' is distinct from previous_description or old_item->>'level' is distinct from previous_level then
    raise exception 'Review has changed; refresh before editing' using errcode='40001';
  end if;
  select jsonb_agg(case when x.item->>'name'=item_name then x.item || jsonb_build_object('description_fa',btrim(description),'level',level) else x.item end order by x.position)
    into new_items from jsonb_array_elements(catalog_snapshot->kind) with ordinality x(item,position);
  update public.studio_catalog c set catalog=jsonb_set(catalog_snapshot,array[kind],new_items) where c.id=true;
  insert into public.studio_catalog_review_audit(actor_id,kind,item_name,previous_description,previous_level,new_description,new_level)
    values(auth.uid(),kind,item_name,old_item->>'description_fa',old_item->>'level',btrim(description),level);
end $$;
revoke all on function public.studio_admin_update_catalog_review(text,text,text,text,text,text) from public, anon;
grant execute on function public.studio_admin_update_catalog_review(text,text,text,text,text,text) to authenticated;
