-- 009_handle_new_user.sql
-- Fixes broken account creation. register.html/auth.js used to insert the
-- new public.profiles row itself, right after supabase.auth.signUp(). That
-- only works if signUp() also returns a live session. When the project has
-- "Confirm email" turned on (the default for new Supabase projects),
-- signUp() returns a user but NO session until the person clicks the
-- confirmation link — so auth.uid() is still null on the client, and the
-- profiles_insert_self policy (id = auth.uid()) rejects the insert. The
-- person would see "user cannot create an account" even though their
-- auth.users row was created fine.
--
-- The fix: create the profile from a SECURITY DEFINER trigger on
-- auth.users, which runs with elevated privileges and doesn't depend on
-- there being a client session at all. username/display_name are passed
-- through signUp()'s `options.data` (raw_user_meta_data) — see auth.js.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user-' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username', 'New user')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
