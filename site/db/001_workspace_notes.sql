-- Agent Studio: private notes owned by authenticated users.
create table public.workspace_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table public.workspace_notes enable row level security;
create policy "Users can read own notes" on public.workspace_notes for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own notes" on public.workspace_notes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can delete own notes" on public.workspace_notes for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, delete on public.workspace_notes to authenticated;
