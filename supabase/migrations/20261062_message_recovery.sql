-- Recovery reads use caller RLS, including account/MFA, membership and expiry.
create or replace function public.recover_chat_messages(
  p_chat uuid, p_since timestamptz, p_after uuid default null, p_limit integer default 100
) returns setof public.messages
language sql stable security invoker set search_path='' as $$
  select m.* from public.messages m
  where m.chat_id=p_chat
    and (m.created_at>=p_since or m.send_at>=p_since)
    and (m.send_at is null or m.send_at<=now())
    and (p_after is null or m.id>p_after)
    and not exists(select 1 from public.message_hides h where h.message_id=m.id and h.user_id=auth.uid())
  order by m.id
  limit greatest(1,least(coalesce(p_limit,100),100))
$$;
revoke all on function public.recover_chat_messages(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.recover_chat_messages(uuid,timestamptz,uuid,integer) to authenticated;
create index if not exists messages_chat_recovery_id_idx on public.messages(chat_id,id);
