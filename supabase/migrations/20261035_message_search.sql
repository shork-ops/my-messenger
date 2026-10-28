-- Phase 2.2: server-side message search.
--
-- The client only had search over the messages it had already downloaded for
-- the open chat, so old history was invisible. A generated tsvector plus a GIN
-- index lets Postgres answer over the whole chat, and an RPC keeps membership
-- checking in one place.
--
-- `russian` is the lead language of the app; a plain `simple` configuration
-- would also work, but it would not fold Russian word forms, so "привет"
-- would not match "приветы". Messages have no language column, therefore the
-- russian config is applied to every body: for English text it degrades to
-- lowercasing, which is still what users expect.

-- ---------------------------------------------------------------------------
-- 1. Search vector, kept in sync by Postgres itself.
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('russian', coalesce(body, ''))) stored;

create index if not exists messages_search_vector_idx
  on public.messages using gin (search_vector);

-- Search is always scoped to one chat and ordered by time, so pair the index
-- with the filter column to keep plans stable on large tables.
create index if not exists messages_chat_created_idx
  on public.messages (chat_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Query helper: turns raw user input into a safe tsquery.
-- ---------------------------------------------------------------------------
create or replace function public.build_search_query(raw_query text)
returns tsquery
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := trim(coalesce(raw_query, ''));
begin
  if cleaned = '' then return null; end if;
  -- Plain to_tsquery ignores punctuation and never raises on bad syntax, which
  -- matters because this runs on every keystroke of the search box.
  return websearch_to_tsquery('russian', cleaned);
end;
$$;

revoke all on function public.build_search_query(text) from public;

-- ---------------------------------------------------------------------------
-- 3. search_messages: membership-checked, paged, with highlighted fragments.
-- ---------------------------------------------------------------------------
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
    and m.search_vector @@ query
  order by m.created_at desc
  limit safe_size
  offset safe_offset;
end;
$$;

revoke all on function public.search_messages(uuid, text, integer, integer) from public;
grant execute on function public.search_messages(uuid, text, integer, integer) to authenticated;
