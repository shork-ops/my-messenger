-- Two server-side checks that did not do what they said.
--
-- 1. A channel handle was meant to be 3-32 characters from a-z, 0-9 and "_", but the check
--    in 20261049 lost its closing "$": it only looked at the first three characters, so
--    "abc-Anything Else!" was accepted. The check is replaced with an anchored one.
--    Rows already stored are not re-checked if any of them would fail (the app has no
--    screen that sets a handle yet, so none are expected); new and changed rows are.
--
-- 2. "Delete for me" (message_hides, 20261043) removed a message from the conversation but
--    search_messages still returned it. Search now leaves out messages the caller hid.
--    The rest of the function is unchanged from 20261052.
--
-- Safe to run more than once.

do $$
declare
  old_check text;
begin
  for old_check in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.chats'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%handle%'
  loop
    execute format('alter table public.chats drop constraint %I', old_check);
  end loop;

  alter table public.chats
    add constraint chats_handle_format
    check (handle is null or handle ~ '^[a-z0-9_]{3,32}$') not valid;

  begin
    alter table public.chats validate constraint chats_handle_format;
  exception when check_violation then
    raise notice 'Some existing channel handles do not match the format; they stay as they are, new and changed ones are checked.';
  end;
end $$;

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
    -- "Delete for me" hides a message from this account everywhere, search included.
    and not exists (
      select 1 from public.message_hides h
      where h.message_id = m.id and h.user_id = actor
    )
    and m.search_vector @@ query
  order by m.created_at desc
  limit safe_size
  offset safe_offset;
end;
$$;

revoke all on function public.search_messages(uuid, text, integer, integer) from public;
grant execute on function public.search_messages(uuid, text, integer, integer) to authenticated;
