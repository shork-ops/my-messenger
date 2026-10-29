-- Avatars live in their own private bucket.
--
-- Why private: a public bucket means anyone holding a URL can fetch the picture
-- forever, including after the owner removes it. Signed URLs keep the file
-- reachable only by people who may see the profile.
--
-- Paths are "{user_id}/{file}", so the storage policies can compare the first
-- path segment with auth.uid() without trusting a client-supplied column.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 5 * 1024 * 1024,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Read: anyone signed in may read avatars. Profiles are searchable by username,
-- so a signed-in user already sees names; blocking the picture would only make
-- the app feel broken without protecting anything.
drop policy if exists "avatars readable by signed-in users" on storage.objects;
create policy "avatars readable by signed-in users"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

-- Write: only into your own folder.
drop policy if exists "avatars writable by owner" on storage.objects;
create policy "avatars writable by owner"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars updatable by owner" on storage.objects;
create policy "avatars updatable by owner"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars deletable by owner" on storage.objects;
create policy "avatars deletable by owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The profile keeps the storage path, not a URL: URLs expire.
alter table public.profiles
  add column if not exists avatar_path text;

comment on column public.profiles.avatar_path is
  'Storage path inside the avatars bucket. Signed into a URL on read.';
