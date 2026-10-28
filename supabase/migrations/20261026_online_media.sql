-- Nexus Messenger online media + realtime reaction permissions.
-- Run in Supabase SQL Editor after schema.sql and the direct-chat migration.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 52428800, array['image/*','video/*','audio/*','application/pdf','text/plain','application/zip','text/csv'])
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "chat media upload by chat members" on storage.objects;
create policy "chat media upload by chat members" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] in (select cm.chat_id::text from public.chat_members cm where cm.user_id = auth.uid())
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "chat media read by chat members" on storage.objects;
create policy "chat media read by chat members" on storage.objects
for select to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] in (select cm.chat_id::text from public.chat_members cm where cm.user_id = auth.uid())
);

drop policy if exists "chat media delete by uploader" on storage.objects;
create policy "chat media delete by uploader" on storage.objects
for delete to authenticated
using (bucket_id = 'chat-media' and (storage.foldername(name))[2] = auth.uid()::text);

-- Realtime needs UPDATE and DELETE events for message edits/deletions.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
