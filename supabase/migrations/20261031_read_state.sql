-- Phase 1: read state for unread counters and read receipts.
-- Run in Supabase SQL Editor after 20261030_poll_and_message_hardening.sql.

create or replace function public.mark_chat_read(target_chat_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  stamped timestamptz := now();
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  update public.chat_members
     set last_read_at = stamped
   where chat_id = target_chat_id
     and user_id = actor;

  if not found then
    raise exception 'Not a chat member' using errcode = '42501';
  end if;

  return stamped;
end;
$$;

revoke all on function public.mark_chat_read(uuid) from public;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- Unread counting reads member rows of a chat; keep that scan cheap.
create index if not exists chat_members_chat_user_idx
  on public.chat_members (chat_id, user_id);

-- Read receipts need member read timestamps streamed to the chat participants.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_members'
  ) then
    alter publication supabase_realtime add table public.chat_members;
  end if;
end $$;
