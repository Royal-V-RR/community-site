-- 010_deltarune_progress.sql
-- Stores Deltarune Trainer progress per account: records, settings and
-- saved loadouts, as one JSON document per user.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

create table if not exists public.deltarune_progress (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint deltarune_progress_size check (pg_column_size(data) < 262144)
);

alter table public.deltarune_progress enable row level security;

drop policy if exists deltarune_progress_select_own on public.deltarune_progress;
create policy deltarune_progress_select_own on public.deltarune_progress
  for select using (auth.uid() = user_id);

drop policy if exists deltarune_progress_insert_own on public.deltarune_progress;
create policy deltarune_progress_insert_own on public.deltarune_progress
  for insert with check (auth.uid() = user_id);

drop policy if exists deltarune_progress_update_own on public.deltarune_progress;
create policy deltarune_progress_update_own on public.deltarune_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists deltarune_progress_delete_own on public.deltarune_progress;
create policy deltarune_progress_delete_own on public.deltarune_progress
  for delete using (auth.uid() = user_id);
