-- 001_schema.sql
-- Core tables, constraints, indexes, and timestamp triggers.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Reusable updated_at trigger function
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  bio text,
  avatar_path text,
  banner_path text,
  role text not null default 'MEMBER' check (role in ('OWNER','ADMIN','MODERATOR','MEMBER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','BANNED','SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_status on public.profiles(status);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Enforce exactly one OWNER at the database level via a partial unique index.
create unique index if not exists uniq_single_owner
  on public.profiles ((role = 'OWNER'))
  where role = 'OWNER';

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  content text not null,
  content_format text not null default 'plain' check (content_format in ('plain','markdown_lite')),
  is_featured boolean not null default false,
  is_pinned boolean not null default false,
  allow_comments boolean not null default true,
  allow_reactions boolean not null default true,
  appearance_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_posts_created_at on public.posts(created_at desc);
create index if not exists idx_posts_author on public.posts(author_id);
create index if not exists idx_posts_pinned on public.posts(is_pinned);
create index if not exists idx_posts_featured on public.posts(is_featured);

drop trigger if exists trg_posts_updated_at on public.posts;
create trigger trg_posts_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- post_attachments
-- ---------------------------------------------------------------------------
create table if not exists public.post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint not null default 0,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_attachments_post on public.post_attachments(post_id, display_order);

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_comments_post on public.comments(post_id, created_at);
create index if not exists idx_comments_author on public.comments(author_id);

drop trigger if exists trg_comments_updated_at on public.comments;
create trigger trg_comments_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- post_reactions
-- ---------------------------------------------------------------------------
create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type text not null default 'like',
  created_at timestamptz not null default now(),
  unique (post_id, user_id, reaction_type)
);

create index if not exists idx_reactions_post on public.post_reactions(post_id);

-- ---------------------------------------------------------------------------
-- forum_threads (single "General" forum, so no separate forums table needed)
-- ---------------------------------------------------------------------------
create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  content text not null,
  is_locked boolean not null default false,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_threads_created_at on public.forum_threads(created_at desc);
create index if not exists idx_threads_pinned on public.forum_threads(is_pinned);

drop trigger if exists trg_threads_updated_at on public.forum_threads;
create trigger trg_threads_updated_at
  before update on public.forum_threads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- forum_replies
-- ---------------------------------------------------------------------------
create table if not exists public.forum_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_replies_thread on public.forum_replies(thread_id, created_at);

drop trigger if exists trg_replies_updated_at on public.forum_replies;
create trigger trg_replies_updated_at
  before update on public.forum_replies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  target_type text,
  target_id uuid,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_read on public.notifications(user_id, is_read, created_at desc);

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN','REVIEWING','RESOLVED','DISMISSED')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_reports_status on public.reports(status, created_at desc);

-- ---------------------------------------------------------------------------
-- moderation_actions
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  action_type text not null,
  target_type text,
  target_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_moderation_target_user on public.moderation_actions(target_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists idx_follows_follower on public.follows(follower_id);
create index if not exists idx_follows_following on public.follows(following_id);

-- ---------------------------------------------------------------------------
-- site_settings
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

drop trigger if exists trg_site_settings_updated_at on public.site_settings;
create trigger trg_site_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

-- Default limits, editable later without a redeploy.
insert into public.site_settings (key, value)
values ('upload_limits', '{"max_file_size_mb": 25, "max_files_per_post": 10}'::jsonb)
on conflict (key) do nothing;
