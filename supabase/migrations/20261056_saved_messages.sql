-- 20261056: «Избранное» on every device.
--
-- Favourites used to live in the open tab only: in a cloud account the list of chats is read
-- from the server on every start, and the favourites chat, which was not on the server, was
-- gone after a reload. Saved messages now get a table of their own.
--
-- A copy, not a pointer: a saved message stays when the original is deleted, edited or purged
-- by a timer, which is the point of saving it. Only the text, the author's name and the
-- attachment's description are copied; the file itself stays where it is, and the storage
-- rules decide, as before, who may open it - leaving a chat closes its files.
--
-- A photo sent "to be seen once" is never saved: keeping it would break the promise made to
-- the sender. The check below refuses it even if a client tries.
--
-- Only the owner reads, adds, corrects and removes their saved messages. Nobody else, the other
-- person in the chat included, learns what was saved. Only the text can be corrected; the
-- owner, the author and the attachment stay as they were saved.
--
-- Safe to run more than once.

create table if not exists public.saved_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author text not null default '',
  body text not null default '',
  attachment jsonb,
  created_at timestamptz not null default now(),
  constraint saved_messages_author_length check (char_length(author) <= 200),
  constraint saved_messages_body_length check (char_length(body) <= 10000),
  constraint saved_messages_not_empty check (char_length(body) > 0 or attachment is not null),
  constraint saved_messages_attachment_size check (attachment is null or pg_column_size(attachment) <= 32768),
  constraint saved_messages_no_view_once check (attachment is null or coalesce(attachment ->> 'viewOnce', 'false') <> 'true')
);

create index if not exists saved_messages_owner_created_idx on public.saved_messages (owner_id, created_at);

alter table public.saved_messages enable row level security;

-- New tables get every right by default; here each one is given on purpose.
revoke all on public.saved_messages from anon, authenticated;
grant select, insert, delete on public.saved_messages to authenticated;
grant update (body) on public.saved_messages to authenticated;

drop policy if exists "saved_messages select own" on public.saved_messages;
create policy "saved_messages select own" on public.saved_messages
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "saved_messages insert own" on public.saved_messages;
create policy "saved_messages insert own" on public.saved_messages
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "saved_messages update own" on public.saved_messages;
create policy "saved_messages update own" on public.saved_messages
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "saved_messages delete own" on public.saved_messages;
create policy "saved_messages delete own" on public.saved_messages
  for delete to authenticated using (owner_id = auth.uid());

comment on table public.saved_messages is
  'Messages an account saved for itself («Избранное»). Copies; visible to the owner only.';
