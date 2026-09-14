-- 008_storage_policies.sql
-- Fixes broken avatar/banner/attachment images. uploads.js always calls
-- getPublicUrl(), which only returns a working URL if the bucket itself is
-- marked public — RLS alone doesn't do that. This file both marks the three
-- buckets public (read access) and adds RLS so only the right people can
-- write to them. Assumes the buckets already exist (Storage -> New bucket:
-- avatars, banners, post-attachments) — create them first if you haven't.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

update storage.buckets set public = true where id in ('avatars', 'banners', 'post-attachments');

alter table storage.objects enable row level security;

-- ---------------------------------------------------------------------------
-- avatars: any authenticated user may write only inside their own
-- {user_id}/ folder, matching the path uploads.js writes to.
-- ---------------------------------------------------------------------------
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- banners: identical pattern to avatars.
-- ---------------------------------------------------------------------------
drop policy if exists "banners_insert_own" on storage.objects;
create policy "banners_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "banners_update_own" on storage.objects;
create policy "banners_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "banners_delete_own" on storage.objects;
create policy "banners_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- post-attachments (also used for poll option images): Owner-only writes,
-- matching the posts_insert_owner rule everywhere else in the schema.
-- ---------------------------------------------------------------------------
drop policy if exists "post_attachments_insert_owner" on storage.objects;
create policy "post_attachments_insert_owner" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-attachments' and public.is_owner());

drop policy if exists "post_attachments_update_owner" on storage.objects;
create policy "post_attachments_update_owner" on storage.objects for update to authenticated
  using (bucket_id = 'post-attachments' and public.is_owner());

drop policy if exists "post_attachments_delete_owner" on storage.objects;
create policy "post_attachments_delete_owner" on storage.objects for delete to authenticated
  using (bucket_id = 'post-attachments' and public.is_owner());
