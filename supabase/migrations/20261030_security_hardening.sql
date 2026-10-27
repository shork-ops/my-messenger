-- Security hardening for the exposed Supabase public schema.
-- Apply after schema.sql and all existing migrations.
-- Keep browser access limited to authenticated users and explicitly approved RPCs.

begin;

-- RLS policies do not remove SQL grants. Explicitly remove anonymous table access.
revoke all privileges on table
  public.profiles,
  public.chats,
  public.chat_members,
  public.messages,
  public.message_reactions
from anon;

-- Restore only the operations the authenticated app uses.
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.chats to authenticated;
grant select, insert, delete on public.chat_members to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;

-- Ensure each exposed application table continues to enforce RLS.
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

-- Functions in public are reachable through the Data API. Remove implicit
-- PUBLIC/anon execution and explicitly allow only the authenticated RPCs/helpers.
revoke execute on all functions in schema public from public, anon;

grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.is_chat_admin(uuid) to authenticated;
grant execute on function public.create_group_chat(text) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;
grant execute on function public.vote_on_poll(uuid, text) to authenticated;

-- Trigger functions are invoked by their triggers; callers do not need EXECUTE.
revoke execute on function public.handle_new_nexus_user() from public, anon, authenticated;
revoke execute on function public.set_nexus_updated_at() from public, anon, authenticated;

-- Future tables created by the migration owner should not become anonymously
-- accessible by default. Authenticated grants must be added deliberately per table.
alter default privileges in schema public revoke all on tables from anon;

commit;
