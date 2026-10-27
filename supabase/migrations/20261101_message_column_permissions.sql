-- Restrict authenticated clients to the message columns the UI legitimately edits.
-- Apply AFTER 20261030_security_hardening.sql.
-- This prevents direct PostgREST updates to sender_id, chat_id, attachment and poll.
begin;

revoke update on table public.messages from authenticated;
grant update (body, edited_at, effect, deleted_at) on table public.messages to authenticated;

-- Keep this explicit: the vote RPC is SECURITY DEFINER and owns poll updates.
revoke all on function public.vote_on_poll(uuid, text) from public, anon;
grant execute on function public.vote_on_poll(uuid, text) to authenticated;

commit;
