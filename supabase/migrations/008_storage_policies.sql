-- 008_storage_policies.sql
-- Fixes "Bucket not found" on every image upload, plus broken
-- avatar/banner/attachment images once uploads did work. uploads.js calls
-- supabase.storage.from('avatars'/'banners'/'post-attachments').upload(...),
-- which fails with "Bucket not found" unless those buckets actually exist in
-- Storage — a manual "Storage -> New bucket" step that's easy to skip. This
-- file creates the three buckets itself (safe to re-run), marks them public
-- for read access (getPublicUrl() only returns a working URL if the bucket
-- itself is public — RLS alone doesn't do that), and adds RLS so only the
-- right people can write to them.
-- Paste the CONTENTS of this file into the Supabase SQL Editor. Do not paste the filename.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('banners', 'banners', true),
       ('post-attachments', 'post-attachments', true)
on conflict (id) do update set public = true;

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
