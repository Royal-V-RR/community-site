-- 004_notifications.sql
-- Notification-generating triggers. Never notify a user about their own action.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

-- ---------------------------------------------------------------------------
-- New comment on a post -> notify the post's Owner author
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_author uuid;
begin
  select author_id into post_author from public.posts where id = new.post_id;

  if post_author is not null and post_author <> new.author_id then
    insert into public.notifications (user_id, type, actor_id, target_type, target_id, message)
    values (post_author, 'COMMENT', new.author_id, 'post', new.post_id, 'New comment on your post');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_comment on public.comments;
create trigger trg_notify_comment
  after insert on public.comments
  for each row execute function public.notify_on_comment();

-- ---------------------------------------------------------------------------
-- New forum reply -> notify the thread author
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_author uuid;
begin
  select author_id into thread_author from public.forum_threads where id = new.thread_id;

  if thread_author is not null and thread_author <> new.author_id then
    insert into public.notifications (user_id, type, actor_id, target_type, target_id, message)
    values (thread_author, 'FORUM_REPLY', new.author_id, 'forum_thread', new.thread_id, 'New reply to your thread');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_reply on public.forum_replies;
create trigger trg_notify_reply
  after insert on public.forum_replies
  for each row execute function public.notify_on_reply();

-- ---------------------------------------------------------------------------
-- Moderation action -> notify the affected user (skip self-actions, which
-- should not normally happen but are excluded defensively)
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.target_user_id is not null and new.target_user_id <> new.actor_id then
    insert into public.notifications (user_id, type, actor_id, target_type, target_id, message)
    values (
      new.target_user_id,
      'MODERATION',
      new.actor_id,
      'moderation_action',
      new.id,
      'A staff action affected your account: ' || new.action_type
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_moderation on public.moderation_actions;
create trigger trg_notify_moderation
  after insert on public.moderation_actions
  for each row execute function public.notify_on_moderation();

-- ---------------------------------------------------------------------------
-- Report resolved -> notify the original reporter
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_report_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('RESOLVED','DISMISSED') and old.status is distinct from new.status then
    insert into public.notifications (user_id, type, actor_id, target_type, target_id, message)
    values (
      new.reporter_id,
      'REPORT_RESULT',
      new.resolved_by,
      'report',
      new.id,
      'Your report has been ' || lower(new.status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_report_resolved on public.reports;
create trigger trg_notify_report_resolved
  after update on public.reports
  for each row execute function public.notify_on_report_resolved();

-- Additional index for unread-count queries (created here since it is
-- notification-specific; the base index lives in 001_schema.sql).
create index if not exists idx_notifications_unread_count on public.notifications(user_id) where is_read = false;
