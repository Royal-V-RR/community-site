-- 005_moderation.sql
-- Report handling helpers, moderation audit indexes, and ban/status handling.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

-- ---------------------------------------------------------------------------
-- resolve_report: secure RPC so only staff can move a report out of OPEN
-- ---------------------------------------------------------------------------
create or replace function public.resolve_report(
  target_report_id uuid,
  new_status text,          -- 'RESOLVED' | 'DISMISSED'
  resolution_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorized to resolve reports';
  end if;

  if new_status not in ('RESOLVED','DISMISSED') then
    raise exception 'Invalid resolution status';
  end if;

  update public.reports
  set status = new_status,
      resolved_at = now(),
      resolved_by = auth.uid()
  where id = target_report_id and status in ('OPEN','REVIEWING');

  insert into public.moderation_actions (actor_id, action_type, target_type, target_id, reason)
  values (auth.uid(), 'RESOLVE_REPORT_' || new_status, 'report', target_report_id, resolution_note);
end;
$$;

revoke all on function public.resolve_report(uuid, text, text) from public;
grant execute on function public.resolve_report(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_report_reviewing: lightweight status move so staff can claim a report
-- ---------------------------------------------------------------------------
create or replace function public.mark_report_reviewing(target_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorized to review reports';
  end if;

  update public.reports
  set status = 'REVIEWING'
  where id = target_report_id and status = 'OPEN';
end;
$$;

revoke all on function public.mark_report_reviewing(uuid) from public;
grant execute on function public.mark_report_reviewing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Additional audit/report indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_reports_target on public.reports(target_type, target_id);
create index if not exists idx_moderation_actions_created on public.moderation_actions(created_at desc);
create index if not exists idx_moderation_actions_type on public.moderation_actions(action_type);

-- ---------------------------------------------------------------------------
-- Guard: prevent a BANNED/SUSPENDED user from posting new content.
-- This backstops the RLS insert policies with an explicit, auditable check.
-- ---------------------------------------------------------------------------
create or replace function public.assert_active_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_status text;
begin
  select status into author_status from public.profiles where id = new.author_id;
  if author_status is distinct from 'ACTIVE' then
    raise exception 'Account is not active and cannot post content';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_comments on public.comments;
create trigger trg_guard_comments
  before insert on public.comments
  for each row execute function public.assert_active_author();

drop trigger if exists trg_guard_threads on public.forum_threads;
create trigger trg_guard_threads
  before insert on public.forum_threads
  for each row execute function public.assert_active_author();

drop trigger if exists trg_guard_replies on public.forum_replies;
create trigger trg_guard_replies
  before insert on public.forum_replies
  for each row execute function public.assert_active_author();
