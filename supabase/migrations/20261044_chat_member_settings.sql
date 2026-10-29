-- Per-member chat settings.
--
-- Muting and archiving belong to the person, not the chat: one member silencing a
-- group says nothing about what the others want. chat_members already carries the
-- read mark for the same reason, so the settings live beside it.

alter table public.chat_members
  add column if not exists muted_until timestamptz,
  add column if not exists archived_at timestamptz;

comment on column public.chat_members.muted_until is
  'Silence notifications for this chat until this moment. Null means not muted; a far-future value means muted indefinitely.';
comment on column public.chat_members.archived_at is
  'When the member moved this chat out of the main list. Null means it is not archived.';

create index if not exists chat_members_archived_idx
  on public.chat_members (user_id)
  where archived_at is not null;
