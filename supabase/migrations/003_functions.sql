-- 003_functions.sql
-- Secure server-side RPC functions for privileged actions. Every function
-- resolves the caller's REAL role from profiles (never a client-supplied
-- value), enforces the role hierarchy, and blocks Owner tampering.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

-- ---------------------------------------------------------------------------
-- promote_to_moderator
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_moderator(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_role_name();
  target_role text;
begin
  if caller_role not in ('OWNER','ADMIN') then
    raise exception 'Not authorized to promote users';
  end if;

  select role into target_role from public.profiles where id = target_user_id;
  if target_role is null then
    raise exception 'User not found';
  end if;
  if target_role = 'OWNER' then
    raise exception 'Cannot modify the Owner';
  end if;

  update public.profiles set role = 'MODERATOR' where id = target_user_id;

  insert into public.moderation_actions (actor_id, target_user_id, action_type, reason)
  values (auth.uid(), target_user_id, 'PROMOTE_MODERATOR', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- promote_to_admin (Owner only: prevents Admins from minting peers)
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_role_name();
  target_role text;
begin
  if caller_role <> 'OWNER' then
    raise exception 'Only the Owner can promote to Admin';
  end if;

  select role into target_role from public.profiles where id = target_user_id;
  if target_role is null then
    raise exception 'User not found';
  end if;
  if target_role = 'OWNER' then
    raise exception 'Cannot modify the Owner';
  end if;

  update public.profiles set role = 'ADMIN' where id = target_user_id;

  insert into public.moderation_actions (actor_id, target_user_id, action_type, reason)
  values (auth.uid(), target_user_id, 'PROMOTE_ADMIN', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- demote_staff (back to MEMBER)
-- ---------------------------------------------------------------------------
create or replace function public.demote_staff(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_role_name();
  target_role text;
begin
  select role into target_role from public.profiles where id = target_user_id;
  if target_role is null then
    raise exception 'User not found';
  end if;
  if target_role = 'OWNER' then
    raise exception 'Cannot modify the Owner';
  end if;

  -- Owner can demote anyone; Admin can only demote Moderators.
  if caller_role = 'OWNER' then
    null;
  elsif caller_role = 'ADMIN' and target_role = 'MODERATOR' then
    null;
  else
    raise exception 'Not authorized to demote this user';
  end if;

  update public.profiles set role = 'MEMBER' where id = target_user_id;

  insert into public.moderation_actions (actor_id, target_user_id, action_type, reason)
  values (auth.uid(), target_user_id, 'DEMOTE_STAFF', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- ban_user
-- ---------------------------------------------------------------------------
create or replace function public.ban_user(target_user_id uuid, ban_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_role_name();
  target_role text;
begin
  if not public.is_staff() then
    raise exception 'Not authorized to ban users';
  end if;

  select role into target_role from public.profiles where id = target_user_id;
  if target_role is null then
    raise exception 'User not found';
  end if;
  if target_role = 'OWNER' then
    raise exception 'Cannot ban the Owner';
  end if;
  if target_role in ('ADMIN','MODERATOR') and caller_role <> 'OWNER' then
    raise exception 'Only the Owner can ban staff members';
  end if;

  update public.profiles set status = 'BANNED' where id = target_user_id;

  insert into public.moderation_actions (actor_id, target_user_id, action_type, reason)
  values (auth.uid(), target_user_id, 'BAN', ban_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- unban_user
-- ---------------------------------------------------------------------------
create or replace function public.unban_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorized to unban users';
  end if;

  update public.profiles set status = 'ACTIVE'
  where id = target_user_id and status = 'BANNED';

  insert into public.moderation_actions (actor_id, target_user_id, action_type, reason)
  values (auth.uid(), target_user_id, 'UNBAN', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- moderate_content: soft-delete a comment or forum reply, or lock a thread
-- ---------------------------------------------------------------------------
create or replace function public.moderate_content(
  content_type text,       -- 'comment' | 'forum_reply' | 'forum_thread'
  content_id uuid,
  action text,              -- 'delete' | 'lock' | 'unlock'
  mod_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorized to moderate content';
  end if;

  if content_type = 'comment' and action = 'delete' then
    update public.comments set deleted_at = now() where id = content_id;
  elsif content_type = 'forum_reply' and action = 'delete' then
    update public.forum_replies set deleted_at = now() where id = content_id;
  elsif content_type = 'forum_thread' and action = 'lock' then
    update public.forum_threads set is_locked = true where id = content_id;
  elsif content_type = 'forum_thread' and action = 'unlock' then
    update public.forum_threads set is_locked = false where id = content_id;
  else
    raise exception 'Unsupported moderation action';
  end if;

  insert into public.moderation_actions (actor_id, action_type, target_type, target_id, reason)
  values (auth.uid(), upper(action) || '_' || upper(content_type), content_type, content_id, mod_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_post_with_attachments (Owner only)
-- ---------------------------------------------------------------------------
create or replace function public.delete_post_with_attachments(target_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the Owner can delete posts';
  end if;

  delete from public.post_attachments where post_id = target_post_id;
  delete from public.posts where id = target_post_id;

  insert into public.moderation_actions (actor_id, action_type, target_type, target_id, reason)
  values (auth.uid(), 'DELETE_POST', 'post', target_post_id, null);
end;
$$;

revoke all on function public.promote_to_moderator(uuid) from public;
revoke all on function public.promote_to_admin(uuid) from public;
revoke all on function public.demote_staff(uuid) from public;
revoke all on function public.ban_user(uuid, text) from public;
revoke all on function public.unban_user(uuid) from public;
revoke all on function public.moderate_content(text, uuid, text, text) from public;
revoke all on function public.delete_post_with_attachments(uuid) from public;

grant execute on function public.promote_to_moderator(uuid) to authenticated;
grant execute on function public.promote_to_admin(uuid) to authenticated;
grant execute on function public.demote_staff(uuid) to authenticated;
grant execute on function public.ban_user(uuid, text) to authenticated;
grant execute on function public.unban_user(uuid) to authenticated;
grant execute on function public.moderate_content(text, uuid, text, text) to authenticated;
grant execute on function public.delete_post_with_attachments(uuid) to authenticated;
