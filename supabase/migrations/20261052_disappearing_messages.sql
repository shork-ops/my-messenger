-- Disappearing messages.
--
-- A chat can carry a timer: every message written while it is on is removed for everyone once
-- its time runs out. The rule lives in the database rather than in the app. A timer kept by
-- the sender's browser stops when the tab closes, and a timer kept by the reader's browser is a
-- request the other side's app is free to ignore.
--
-- Three parts:
--   1. the chat stores the timer, and only people allowed to change it can;
--   2. each message gets its deadline when it is written - from the chat, never from the client;
--   3. a message past its deadline is no longer returned to anyone, and a scheduled job deletes it.
--
-- Honest limits. Without end-to-end encryption the server holds the text until the deadline,
-- and anyone in the chat can copy or photograph a message before it goes. The timer keeps a
-- conversation from piling up; it is not a secrecy guarantee, and the app must not present it
-- as one.
--
-- Apply after 20261051_content_reports.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. The timer on the chat.
-- ---------------------------------------------------------------------------
-- A short fixed list rather than any number: the app offers these four, and a free value
-- would let a modified client set a one-second timer that deletes replies before they are read.
alter table public.chats
  add column if not exists message_ttl_seconds integer;

alter table public.chats drop constraint if exists chats_message_ttl_check;
alter table public.chats add constraint chats_message_ttl_check
  check (message_ttl_seconds is null or message_ttl_seconds in (3600, 86400, 604800, 2592000));

comment on column public.chats.message_ttl_seconds is
  'Disappearing messages: seconds a new message lives. Null means messages stay.';

-- ---------------------------------------------------------------------------
-- 2. The deadline on each message.
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists expires_at timestamptz;

comment on column public.messages.expires_at is
  'Set by the server from the chat timer when the message is written. Null means it stays.';

-- Only messages with a deadline are ever looked up by it.
create index if not exists messages_expires_at_idx
  on public.messages (expires_at)
  where expires_at is not null;

-- Whatever the client sends in expires_at is replaced, so a modified app can neither keep its
-- own message forever nor shorten someone else's.
create or replace function public.set_message_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ttl integer;
begin
  if tg_op = 'INSERT' then
    select c.message_ttl_seconds into ttl from public.chats c where c.id = new.chat_id;
    if ttl is null then
      new.expires_at := null;
    else
      -- A scheduled message starts its countdown when it is delivered, not when it was typed.
      new.expires_at := greatest(coalesce(new.send_at, now()), now()) + make_interval(secs => ttl);
    end if;
    return new;
  end if;

  -- An update keeps the deadline fixed at writing. Moving a scheduled message moves its
  -- deadline by the same amount; nothing else may change it.
  if old.expires_at is not null and new.send_at is distinct from old.send_at then
    new.expires_at := greatest(coalesce(new.send_at, now()), now())
      + (old.expires_at - greatest(coalesce(old.send_at, old.created_at), old.created_at));
  else
    new.expires_at := old.expires_at;
  end if;
  return new;
end;
$$;

revoke all on function public.set_message_expiry() from public, anon, authenticated;

drop trigger if exists messages_set_expiry on public.messages;
create trigger messages_set_expiry
before insert or update of send_at, expires_at on public.messages
for each row execute function public.set_message_expiry();

-- ---------------------------------------------------------------------------
-- 3. Past the deadline, a message is gone for everyone.
-- ---------------------------------------------------------------------------
-- Restrictive, so it narrows every other read rule instead of adding to them. It takes effect
-- the moment the deadline passes, without waiting for the cleanup job below.
drop policy if exists "messages_hide_expired" on public.messages;
create policy "messages_hide_expired" on public.messages
as restrictive
for select to authenticated
using (expires_at is null or expires_at > now());

-- Functions below run as their owner and do not see the policy above, so each one that hands
-- message content back repeats the rule. search_messages also gains the scheduled-message rule
-- it was missing: another member's message must not turn up in search before it is delivered.
create or replace function public.search_messages(
  target_chat_id uuid,
  search_query text,
  page_size integer default 30,
  page_offset integer default 0
)
returns table (
  id uuid,
  chat_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  edited_at timestamptz,
  rank real,
  headline text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  query tsquery;
  safe_size integer := least(greatest(coalesce(page_size, 30), 1), 100);
  safe_offset integer := greatest(coalesce(page_offset, 0), 0);
begin
  if actor is null then raise exception 'Authentication required'; end if;
  -- A non-member must not be able to probe a chat through search results.
  if not public.is_chat_member(target_chat_id) then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;

  query := public.build_search_query(search_query);
  if query is null then return; end if;

  return query
  select
    m.id,
    m.chat_id,
    m.sender_id,
    m.body,
    m.created_at,
    m.edited_at,
    ts_rank(m.search_vector, query) as rank,
    -- <mark>…</mark> is rendered client-side into <mark> elements, never as HTML.
    ts_headline(
      'russian',
      m.body,
      query,
      'StartSel=<mark>, StopSel=</mark>, MaxWords=32, MinWords=8, ShortWord=2'
    ) as headline
  from public.messages m
  where m.chat_id = target_chat_id
    and m.deleted_at is null
    and (m.send_at is null or m.send_at <= now() or m.sender_id = actor)
    and (m.expires_at is null or m.expires_at > now())
    and m.search_vector @@ query
  order by m.created_at desc
  limit safe_size
  offset safe_offset;
end;
$$;

revoke all on function public.search_messages(uuid, text, integer, integer) from public;
grant execute on function public.search_messages(uuid, text, integer, integer) to authenticated;

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
    and (m.send_at is null or m.send_at <= now() or m.sender_id = actor)
    and (m.expires_at is null or m.expires_at > now())
  order by m.pinned_at desc
  limit least(greatest(coalesce(limit_count, 20), 1), 100);
end;
$$;

revoke all on function public.pinned_messages(uuid, integer) from public;
grant execute on function public.pinned_messages(uuid, integer) to authenticated;

-- Single-view media that has not been opened before its message expired stays closed.
create or replace function public.claim_view_once_message(p_message uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.messages%rowtype; inserted integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into item from public.messages where id=p_message for update;
  if not found or item.sender_id=actor or item.deleted_at is not null
    or (item.send_at is not null and item.send_at>now())
    or (item.expires_at is not null and item.expires_at<=now())
    or not public.is_chat_member(item.chat_id)
    or item.attachment->>'viewOnce' is distinct from 'true'
    or item.attachment->>'bucket' is distinct from 'view-once-media'
    or split_part(item.attachment->>'path','/',1) is distinct from item.chat_id::text
    or split_part(item.attachment->>'path','/',2) is distinct from item.sender_id::text
  then raise exception 'Media unavailable' using errcode='42501'; end if;
  if public.is_blocked_between(actor,item.sender_id) then raise exception 'Media unavailable' using errcode='42501'; end if;
  insert into public.view_once_receipts(message_id,user_id) values(p_message,actor) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then raise exception 'Media already opened' using errcode='P0001'; end if;
  return jsonb_build_object('path',item.attachment->>'path');
end; $$;
revoke all on function public.claim_view_once_message(uuid) from public,anon;
grant execute on function public.claim_view_once_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Changing the timer.
-- ---------------------------------------------------------------------------
-- In a direct chat either person may change it, as in other messengers. In a group or a
-- channel it is a rule of the place, so only its owner and admins may.
create or replace function public.set_chat_message_ttl(target_chat uuid, ttl_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.chats%rowtype;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if ttl_seconds is not null and ttl_seconds not in (3600, 86400, 604800, 2592000) then
    raise exception 'Unsupported timer' using errcode = '22023';
  end if;

  select * into target from public.chats where id = target_chat;
  if not found or not public.is_chat_member(target_chat) then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;
  if (target.is_group or coalesce(target.is_channel, false)) and not public.is_chat_admin(target_chat) then
    raise exception 'Only admins can change the timer here' using errcode = '42501';
  end if;

  update public.chats set message_ttl_seconds = ttl_seconds where id = target_chat;
  return ttl_seconds;
end;
$$;

revoke all on function public.set_chat_message_ttl(uuid, integer) from public, anon;
grant execute on function public.set_chat_message_ttl(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Deleting what has expired.
-- ---------------------------------------------------------------------------
-- Reactions, receipts and "hidden for me" marks go with the message (their foreign keys
-- cascade), and replies keep their text but lose the link to the deleted original.
--
-- A message somebody complained about stays until a moderator has looked at it. It is already
-- hidden from everyone in the chat by the policy above; deleting it would delete the evidence.
create or replace function public.purge_expired_messages(batch_size integer default 5000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.messages doomed
  where doomed.id in (
    select m.id
    from public.messages m
    where m.expires_at is not null
      and m.expires_at <= now()
      and not exists (
        select 1 from public.content_reports r
        where r.message_id = m.id and r.status = 'open'
      )
    order by m.expires_at
    limit least(greatest(coalesce(batch_size, 5000), 1), 50000)
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Nobody signs in and runs this: it is for the scheduled job and the service role.
revoke all on function public.purge_expired_messages(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_messages(integer) to service_role;

-- Every five minutes, if pg_cron can be used. Without it expired messages are still hidden
-- from everyone (section 3); they only stay in the table until the job runs.
do $do$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron is not available here: %', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'nexus-purge-expired-messages',
      '*/5 * * * *',
      $job$select public.purge_expired_messages(5000)$job$
    );
  else
    raise notice 'Enable pg_cron and schedule public.purge_expired_messages() to delete expired messages.';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 6. Telling the other side.
-- ---------------------------------------------------------------------------
-- Chat rows join the realtime feed so a timer switched on by one person shows up for the
-- other at once. Members only: realtime applies the same read policy as a query.
do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chats'
     ) then
    alter publication supabase_realtime add table public.chats;
  end if;
end
$do$;

commit;
