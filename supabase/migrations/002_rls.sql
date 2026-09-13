-- 002_rls.sql
-- Row Level Security policies. This is the real security boundary; the frontend
-- role checks in navigation.js/admin.js are for UI only.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

-- ---------------------------------------------------------------------------
-- Helper: current caller's real role/status, read from profiles (never trust
-- any role value sent from the client).
-- ---------------------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select status from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role in ('OWNER','ADMIN','MODERATOR') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'OWNER' from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on all public tables
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_attachments enable row level security;
alter table public.comments enable row level security;
alter table public.post_reactions enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_replies enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.follows enable row level security;
alter table public.site_settings enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid() and role = 'MEMBER' and status = 'ACTIVE');

-- Users may update their own editable fields, but role/status changes are
-- blocked here and only permitted through the secure RPC functions
-- (which run as SECURITY DEFINER and bypass this policy's own restriction).
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and status = (select status from public.profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- posts (Owner-only writes, enforced server-side)
-- ---------------------------------------------------------------------------
drop policy if exists posts_select_all on public.posts;
create policy posts_select_all on public.posts
  for select using (true);

drop policy if exists posts_insert_owner on public.posts;
create policy posts_insert_owner on public.posts
  for insert with check (author_id = auth.uid() and public.is_owner());

drop policy if exists posts_update_owner on public.posts;
create policy posts_update_owner on public.posts
  for update using (public.is_owner());

drop policy if exists posts_delete_owner on public.posts;
create policy posts_delete_owner on public.posts
  for delete using (public.is_owner());

-- ---------------------------------------------------------------------------
-- post_attachments (follow the parent post's owner-only write rule)
-- ---------------------------------------------------------------------------
drop policy if exists attachments_select_all on public.post_attachments;
create policy attachments_select_all on public.post_attachments
  for select using (true);

drop policy if exists attachments_write_owner on public.post_attachments;
create policy attachments_write_owner on public.post_attachments
  for all using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments
  for select using (true);

drop policy if exists comments_insert_authenticated on public.comments;
create policy comments_insert_authenticated on public.comments
  for insert with check (
    author_id = auth.uid()
    and coalesce(public.current_status(), 'ACTIVE') = 'ACTIVE'
    and exists (select 1 from public.posts p where p.id = post_id and p.allow_comments)
  );

drop policy if exists comments_update_own_or_staff on public.comments;
create policy comments_update_own_or_staff on public.comments
  for update using (author_id = auth.uid() or public.is_staff());

drop policy if exists comments_delete_own_or_staff on public.comments;
create policy comments_delete_own_or_staff on public.comments
  for delete using (author_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------
-- post_reactions
-- ---------------------------------------------------------------------------
drop policy if exists reactions_select_all on public.post_reactions;
create policy reactions_select_all on public.post_reactions
  for select using (true);

drop policy if exists reactions_insert_self on public.post_reactions;
create policy reactions_insert_self on public.post_reactions
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.allow_reactions)
  );

drop policy if exists reactions_delete_self on public.post_reactions;
create policy reactions_delete_self on public.post_reactions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- forum_threads (General)
-- ---------------------------------------------------------------------------
drop policy if exists threads_select_all on public.forum_threads;
create policy threads_select_all on public.forum_threads
  for select using (true);

drop policy if exists threads_insert_authenticated on public.forum_threads;
create policy threads_insert_authenticated on public.forum_threads
  for insert with check (author_id = auth.uid() and coalesce(public.current_status(), 'ACTIVE') = 'ACTIVE');

drop policy if exists threads_update_own_or_staff on public.forum_threads;
create policy threads_update_own_or_staff on public.forum_threads
  for update using (
    (author_id = auth.uid() and not is_locked)
    or public.is_staff()
  );

drop policy if exists threads_delete_own_or_staff on public.forum_threads;
create policy threads_delete_own_or_staff on public.forum_threads
  for delete using (author_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------
-- forum_replies
-- ---------------------------------------------------------------------------
drop policy if exists replies_select_all on public.forum_replies;
create policy replies_select_all on public.forum_replies
  for select using (true);

drop policy if exists replies_insert_authenticated on public.forum_replies;
create policy replies_insert_authenticated on public.forum_replies
  for insert with check (
    author_id = auth.uid()
    and coalesce(public.current_status(), 'ACTIVE') = 'ACTIVE'
    and exists (select 1 from public.forum_threads t where t.id = thread_id and not t.is_locked)
  );

drop policy if exists replies_update_own_or_staff on public.forum_replies;
create policy replies_update_own_or_staff on public.forum_replies
  for update using (author_id = auth.uid() or public.is_staff());

drop policy if exists replies_delete_own_or_staff on public.forum_replies;
create policy replies_delete_own_or_staff on public.forum_replies
  for delete using (author_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------
-- notifications (private to recipient)
-- ---------------------------------------------------------------------------
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Inserts happen via SECURITY DEFINER trigger functions in 004_notifications.sql,
-- so no direct client insert policy is granted.

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
drop policy if exists reports_insert_authenticated on public.reports;
create policy reports_insert_authenticated on public.reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists reports_select_own_or_staff on public.reports;
create policy reports_select_own_or_staff on public.reports
  for select using (reporter_id = auth.uid() or public.is_staff());

-- Only staff may transition status; enforced by requiring is_staff() and
-- forbidding regular users from updating at all.
drop policy if exists reports_update_staff_only on public.reports;
create policy reports_update_staff_only on public.reports
  for update using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- moderation_actions (protected: staff can read, writes go through RPC)
-- ---------------------------------------------------------------------------
drop policy if exists moderation_actions_select_staff on public.moderation_actions;
create policy moderation_actions_select_staff on public.moderation_actions
  for select using (public.is_staff());

-- No direct insert/update/delete policies: rows are written only by
-- SECURITY DEFINER functions in 003_functions.sql.

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
drop policy if exists follows_select_all on public.follows;
create policy follows_select_all on public.follows
  for select using (true);

drop policy if exists follows_insert_self on public.follows;
create policy follows_insert_self on public.follows
  for insert with check (follower_id = auth.uid() and follower_id <> following_id);

drop policy if exists follows_delete_self on public.follows;
create policy follows_delete_self on public.follows
  for delete using (follower_id = auth.uid());

-- ---------------------------------------------------------------------------
-- site_settings (protected: readable by all, writable only by Owner)
-- ---------------------------------------------------------------------------
drop policy if exists site_settings_select_all on public.site_settings;
create policy site_settings_select_all on public.site_settings
  for select using (true);

drop policy if exists site_settings_write_owner on public.site_settings;
create policy site_settings_write_owner on public.site_settings
  for all using (public.is_owner()) with check (public.is_owner());
