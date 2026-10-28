-- Phase 2.3: pinned messages.
--
-- Pin state lives on the message row rather than in a separate table: a pin is
-- "this message is pinned in its own chat", and one nullable column expresses
-- that with no joins and no orphan rows. The author is recorded so the UI can
-- say who pinned it, which matters in groups.
--
-- Forwarding needs no schema change: a forwarded message is a normal message
-- whose body carries a `forwarded_from` prefix, and the sender is the forwarder
-- (the server keeps sender_id honest, as before).

alter table public.messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references auth.users(id) on delete set null;

comment on column public.messages.pinned_at is 'When the message was pinned to the chat header. Null means not pinned.';

-- The chat header lists pins newest-first, so index the hot path.
create index if not exists messages_chat_pinned_idx
  on public.messages (chat_id, pinned_at desc)
  where pinned_at is not null;

-- ---------------------------------------------------------------------------
-- Pin / unpin. Any member may pin in a direct chat; in groups only admins,
-- otherwise one participant could decorate the header for everybody.
-- ---------------------------------------------------------------------------
create or replace function public.set_message_pin(target_message_id uuid, pinned boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_chat uuid;
  is_group_chat boolean;
  stamp timestamptz;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  select m.chat_id, c.is_group into target_chat, is_group_chat
  from public.messages m
  join public.chats c on c.id = m.chat_id
  where m.id = target_message_id and m.deleted_at is null;

  if target_chat is null then raise exception 'Message not found'; end if;
  if not public.is_chat_member(target_chat) then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;
  if is_group_chat and not public.is_chat_admin(target_chat) then
    raise exception 'Only admins can pin messages in a group' using errcode = '42501';
  end if;

  if pinned then
    stamp := now();
    update public.messages
       set pinned_at = stamp, pinned_by = actor
     where id = target_message_id;
  else
    stamp := null;
    update public.messages
       set pinned_at = null, pinned_by = null
     where id = target_message_id;
  end if;

  return stamp;
end;
$$;

revoke all on function public.set_message_pin(uuid, boolean) from public;
grant execute on function public.set_message_pin(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Pinned list for the chat header card.
-- ---------------------------------------------------------------------------
create or replace function public.pinned_messages(target_chat_id uuid, limit_count integer default 20)
returns table (
  id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  pinned_at timestamptz,
  pinned_by uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not public.is_chat_member(target_chat_id) then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;

  return query
  select m.id, m.sender_id, m.body, m.created_at, m.pinned_at, m.pinned_by
  from public.messages m
  where m.chat_id = target_chat_id
    and m.pinned_at is not null
    and m.deleted_at is null
  order by m.pinned_at desc
  limit least(greatest(coalesce(limit_count, 20), 1), 100);
end;
$$;

revoke all on function public.pinned_messages(uuid, integer) from public;
grant execute on function public.pinned_messages(uuid, integer) to authenticated;
