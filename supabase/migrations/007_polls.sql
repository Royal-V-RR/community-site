-- 007_polls.sql
-- Adds single-choice polls to posts, with an optional image per option.
-- A poll belongs to exactly one post and can only be created/edited by the
-- Owner (same rule as posts themselves). Voting is one option per user per
-- poll; changing a vote means deleting the old row and inserting a new one
-- (poll.js does this as two calls).
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

-- ---------------------------------------------------------------------------
-- polls
-- ---------------------------------------------------------------------------
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  question text not null,
  closes_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_polls_post on public.polls(post_id);

-- ---------------------------------------------------------------------------
-- poll_options
-- ---------------------------------------------------------------------------
create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null,
  image_path text,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_poll_options_poll on public.poll_options(poll_id, display_order);

-- ---------------------------------------------------------------------------
-- poll_votes (one row per user per poll = single choice)
-- ---------------------------------------------------------------------------
create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create index if not exists idx_poll_votes_option on public.poll_votes(option_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists polls_select_all on public.polls;
create policy polls_select_all on public.polls
  for select using (true);

drop policy if exists polls_write_owner on public.polls;
create policy polls_write_owner on public.polls
  for all using (public.is_owner()) with check (
    public.is_owner()
    and exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

drop policy if exists poll_options_select_all on public.poll_options;
create policy poll_options_select_all on public.poll_options
  for select using (true);

drop policy if exists poll_options_write_owner on public.poll_options;
create policy poll_options_write_owner on public.poll_options
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists poll_votes_select_all on public.poll_votes;
create policy poll_votes_select_all on public.poll_votes
  for select using (true);

drop policy if exists poll_votes_insert_self on public.poll_votes;
create policy poll_votes_insert_self on public.poll_votes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.polls pl
      where pl.id = poll_id and (pl.closes_at is null or pl.closes_at > now())
    )
  );

drop policy if exists poll_votes_delete_self on public.poll_votes;
create policy poll_votes_delete_self on public.poll_votes
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Guard: block votes on a post whose author disabled reactions/comments?
-- No — polls are independent of those flags. Just block voting on a closed
-- poll at the trigger level too, as a backstop to the RLS check above.
-- ---------------------------------------------------------------------------
create or replace function public.assert_poll_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  poll_closes_at timestamptz;
begin
  select closes_at into poll_closes_at from public.polls where id = new.poll_id;
  if poll_closes_at is not null and poll_closes_at <= now() then
    raise exception 'This poll is closed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_poll_votes on public.poll_votes;
create trigger trg_guard_poll_votes
  before insert on public.poll_votes
  for each row execute function public.assert_poll_open();
