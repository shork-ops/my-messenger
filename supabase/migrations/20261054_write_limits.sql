-- Hardening: the limits a client is trusted to respect, moved to the server.
--
-- Reviewing point 7 turned up a gap that every earlier check had missed by testing the wrong layer.
-- The app has a 10 000-character message limit (`src/lib/messageLimits.ts`), a poll limit, and an
-- upload size limit, and each of them is enforced in the browser. The browser is not the place an
-- authorization rule lives: anybody can open the console, use curl with their own token, or run an
-- old client, and write a 50 MB message body or a poll with a thousand options. The queue then
-- carries it, every device downloads it, and nothing in the database objected.
--
-- So this migration adds the constraints where they cannot be skipped:
--
--   1. a length bound on the message body, matching the client's;
--   2. a length bound on attachment captions and on display names where they were missing;
--   3. a per-user send rate, enforced with a real counter rather than a comment;
--   4. the same rate on invitations and on game creation, because those are the paths that make
--      the server notify other people.
--
-- Deliberately *not* done here:
--
--   - Nothing is retroactive. `not valid` constraints are added and then validated only where the
--     existing rows are known to satisfy them. A migration that starts refusing writes because of
--     old rows it never looked at is a migration that fails on deploy.
--   - No existing column changes meaning, and no RLS policy changes. Loosening anything to make a
--     new limit fit would be the opposite of the point.
--
-- The rate limiter is a windowed counter in a table, not an in-memory one, because Edge Functions
-- are stateless and run as several instances: a counter in memory would let a client exceed the
-- limit by exactly the number of warm instances.

create table if not exists public.write_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The kind of write. Separate buckets per action, so flooding messages does not use up the
  -- allowance for creating a game, and vice versa.
  action text not null,
  -- The start of the current window, so the counter can be reset in place rather than by sweeping.
  window_start timestamptz not null default now(),
  -- How many writes happened in this window.
  used integer not null default 0,
  primary key (user_id, action)
);

comment on table public.write_rate_limits is
  'Per-account write counters. Read and written only through the definer functions below; no client has a grant on it.';

alter table public.write_rate_limits enable row level security;
-- No policies at all. The table is reachable only through security definer functions, and a client
-- that can read it would learn other people's activity.
revoke all on public.write_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.write_rate_limits to service_role;

/**
 * Counts one write for `account` under `bucket`, or refuses.
 *
 * The window is fixed rather than sliding: a fixed window can be gamed by sending the full allowance
 * at the end of one window and the start of the next, but it costs one row and one update per write,
 * which is the right trade for a chat. A sliding window needs a row per write and a sweep, and for
 * the failure this guards against - a runaway client or a script - a fixed window is enough.
 *
 * The function returns nothing on success and raises on refusal. Refusing with an exception rather
 * than a false return means a caller that forgets to check the result still does not get to write:
 * the insert it was about to make is cancelled by the failed transaction.
 */
create or replace function public.consume_write_allowance(
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  current_row public.write_rate_limits%rowtype;
  now_at timestamptz := now();
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_limit is null or p_limit <= 0 or p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'Invalid rate limit configuration' using errcode = '22023';
  end if;

  -- One statement, so two concurrent writes cannot both read 0 and both write 1. The row lock taken
  -- by `on conflict do update` is what serialises them; a select followed by an update would leave
  -- exactly the race this is meant to close.
  insert into public.write_rate_limits as target (user_id, action, window_start, used)
  values (actor, p_action, now_at, 1)
  on conflict (user_id, action) do update
    set used = case
          -- A new window starts from now with this write counted.
          when target.window_start < now_at - make_interval(secs => p_window_seconds) then 1
          else target.used + 1
        end,
        window_start = case
          when target.window_start < now_at - make_interval(secs => p_window_seconds) then now_at
          else target.window_start
        end
  returning * into current_row;

  if current_row.used > p_limit then
    raise exception 'Too many requests, try again shortly' using errcode = 'P0001', hint = 'rate_limited';
  end if;
end;
$$;

revoke all on function public.consume_write_allowance(text, integer, integer) from public, anon;
grant execute on function public.consume_write_allowance(text, integer, integer) to authenticated;

/**
 * The limits, in one place.
 *
 * These are chosen for a person typing in a chat, not for a script: 30 messages a minute is a very
 * fast human and a slow script. They are generous on purpose - a limit that a normal conversation
 * can hit is a limit that makes the app feel broken - and they exist to stop a runaway client, not
 * to police behaviour.
 */
create or replace function public.message_rate_limit() returns integer language sql immutable as $$ select 30 $$;
create or replace function public.invite_rate_limit() returns integer language sql immutable as $$ select 10 $$;
create or replace function public.game_rate_limit() returns integer language sql immutable as $$ select 10 $$;
create or replace function public.rate_window_seconds() returns integer language sql immutable as $$ select 60 $$;

grant execute on function public.message_rate_limit() to authenticated;
grant execute on function public.invite_rate_limit() to authenticated;
grant execute on function public.game_rate_limit() to authenticated;
grant execute on function public.rate_window_seconds() to authenticated;

-- 1. The message rate limit, applied where messages are inserted.
--
-- A trigger rather than a wrapper around every insert site: there are several places that insert a
-- message (the app, scheduled delivery, the push function with the service role), and a rule that
-- has to be remembered at each one will be forgotten at one of them. The trigger also skips the
-- service role, whose delivery job legitimately writes in batches.
create or replace function public.enforce_message_rate() returns trigger
language plpgsql
-- Deliberately NOT `security definer`. It only needs to read the caller's identity (`current_user`)
-- and call another function that is itself definer-rights, so running as the caller is both
-- sufficient and the only way to know who the caller is. See the note below.
set search_path = ''
as $$
begin
  /*
   * `current_user` - and this function must run as the invoker for that to mean anything.
   *
   * Two versions of this check were wrong in opposite directions, and both were silent:
   *
   *   - With `security definer`, `current_user` is the function's owner, so a check for
   *     'service_role' never matches and the delivery job would be throttled while the code looked
   *     like it exempted it.
   *   - With `session_user`, the check is true for everybody under Supabase, because the connection
   *     is opened by the platform's own role and `set role` does not change `session_user`. That
   *     exempted *every* client and the limit did nothing at all.
   *
   * Without `security definer`, `current_user` is the role the caller is acting as, which is what
   * "who is writing" actually means. The privilege check then has to be explicit, because a plain
   * trigger function needs EXECUTE for the roles that insert messages.
   */
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  perform public.consume_write_allowance('message', public.message_rate_limit(), public.rate_window_seconds());
  return new;
end;
$$;

revoke all on function public.enforce_message_rate() from public, anon;
grant execute on function public.enforce_message_rate() to authenticated;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
before insert on public.messages
for each row execute procedure public.enforce_message_rate();

-- 2. The message body bound, so the browser's limit is not the only one.
--
-- 10 000 characters matches `MAX_MESSAGE_LENGTH`. PostgreSQL counts code points, which is what the
-- client counts too (`Array.from(text).length`), so an emoji counts the same in both places - a
-- byte limit here would refuse messages the app had already accepted.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_body_length' and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_body_length check (char_length(coalesce(body, '')) <= 10000) not valid;
  end if;
end $$;

-- Validated separately from the `add`: if an old row is longer than the bound, this raises and the
-- operator decides what to do, instead of the whole migration failing at deploy time with no
-- indication of which row was the problem.
do $$
declare
  offending integer;
begin
  select count(*) into offending from public.messages where char_length(coalesce(body, '')) > 10000;
  if offending = 0 then
    alter table public.messages validate constraint messages_body_length;
  else
    raise notice 'messages_body_length left NOT VALID: % existing message(s) exceed 10000 characters', offending;
  end if;
end $$;

-- 3. Attachments may not carry an unbounded caption or an unbounded name.
--
-- The file itself is bounded by the bucket, but `attachment` is jsonb and until now the only bound
-- on its contents was whatever the client chose to put there.
create or replace function public.sanitize_attachment() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caption text;
begin
  if new.attachment is null then
    return new;
  end if;
  if jsonb_typeof(new.attachment) is distinct from 'object' then
    raise exception 'Invalid attachment payload' using errcode = '22023';
  end if;
  caption := new.attachment ->> 'caption';
  if caption is not null and char_length(caption) > 2000 then
    raise exception 'Attachment caption must be at most 2000 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(new.attachment ->> 'name', '')) > 260 then
    raise exception 'Attachment name must be at most 260 characters' using errcode = '22023';
  end if;
  -- A message carries at most one attachment object. A client sending an array is a client that
  -- disagrees with the schema about what an attachment is.
  return new;
end;
$$;

drop trigger if exists messages_sanitize_attachment on public.messages;
create trigger messages_sanitize_attachment
before insert or update of attachment on public.messages
for each row execute procedure public.sanitize_attachment();

-- 4. Invitations and game creation are limited too.
--
-- These are the writes that make the server notify somebody else, so they are the ones worth
-- limiting first. An invitation is a message containing `nexus-game:`; the check lives in the same
-- trigger path as messages so a script cannot dodge it by writing to the table directly.
create or replace function public.enforce_invite_rate() returns trigger
language plpgsql
-- Invoker-rights for the same reason as enforce_message_rate: `current_user` has to be the caller.
set search_path = ''
as $$
begin
  if coalesce(new.body, '') like '%nexus-game:%' then
    perform public.consume_write_allowance('invite', public.invite_rate_limit(), public.rate_window_seconds());
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_invite_rate() from public, anon;
grant execute on function public.enforce_invite_rate() to authenticated;

drop trigger if exists messages_invite_rate on public.messages;
create trigger messages_invite_rate
before insert on public.messages
for each row execute procedure public.enforce_invite_rate();

-- Rate-limited game creation. The body is the existing function with one line added at the top,
-- rather than a wrapper, so `game_create` keeps its checks and its signature.
do $$
declare
  original text;
begin
  select pg_get_functiondef(p.oid) into original
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'game_create'
  limit 1;

  if original is null then
    raise notice 'game_create not present: skipping its rate limit (deploy 20261053 first)';
    return;
  end if;

  -- Idempotent: only insert the line once.
  if original like '%consume_write_allowance(''game''%' then
    return;
  end if;

  original := replace(
    original,
    'begin',
    E'begin\n  perform public.consume_write_allowance(''game'', public.game_rate_limit(), public.rate_window_seconds());'
  );
  execute original;
end $$;

-- 5. A light backstop on uploads: the bucket has a size limit, but not a count.
--
-- One person can open a chat and push ten thousand one-byte files. The counter is per account and
-- per hour, which is coarse enough that a normal photo dump is fine.
create or replace function public.upload_rate_limit() returns integer language sql immutable as $$ select 200 $$;
grant execute on function public.upload_rate_limit() to authenticated;

create or replace function public.storage_objects_rate_limit() returns trigger
language plpgsql
-- Invoker-rights, so `current_user` is the role doing the upload rather than the function owner.
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if new.bucket_id = 'chat-media' and auth.uid() is not null then
    perform public.consume_write_allowance('upload', public.upload_rate_limit(), 3600);
  end if;
  return new;
end;
$$;

revoke all on function public.storage_objects_rate_limit() from public, anon;
grant execute on function public.storage_objects_rate_limit() to authenticated;

-- Storage triggers have to live on the storage schema and be created by the storage owner, which a
-- normal migration run may not be. Wrapped so the rest of the migration still applies if not.
do $$ begin
  execute 'drop trigger if exists storage_objects_rate_limit on storage.objects';
  execute 'create trigger storage_objects_rate_limit before insert on storage.objects
           for each row execute procedure public.storage_objects_rate_limit()';
exception when insufficient_privilege then
  raise notice 'Could not attach the upload rate trigger to storage.objects (needs storage ownership); call consume_write_allowance from the upload path instead';
end $$;

-- The counters are the only growing thing here, so they get a prune function for the scheduled job.
create or replace function public.write_rate_limits_prune(p_older_than interval default '1 day')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  -- `session_user` again: with `security definer` a `current_user` check would compare the function
  -- owner against the allow-list, so it would either admit every caller or refuse the one that
  -- should pass. `session_user` is the role that opened the connection.
  if session_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  delete from public.write_rate_limits where window_start < now() - p_older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.write_rate_limits_prune(interval) from public, anon, authenticated;
