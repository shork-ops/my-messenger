-- Real device sessions: what the account is actually signed in on.
--
-- The settings screen used to show a device list that this browser had invented for itself. It
-- was not a session list at all: it recorded devices that had *opened the app in this browser
-- profile*, including devices that had since been signed out, and it could not see a phone, because
-- a phone writes its own list on the phone. Worse, signing out "other devices" then deleted rows
-- from that local list - it looked like revocation and revoked nothing. This migration replaces the
-- fiction with a record the server keeps.
--
-- Design notes, because the security of this feature lives in them:
--
-- * A row is one *session*, not one device. Two browsers on one laptop are two sessions, and
--   signing one out must not sign the other out. The client generates a random `client_id` per
--   browser profile and keeps it; that is the row's identity.
--
-- * Rows are keyed by `user_id` and every read and every revoke goes through `auth.uid()`. There is
--   deliberately no policy that would let one person list or revoke another person's sessions, and
--   the RPCs below never accept a caller-supplied user id - the only owner they can act on is the
--   one in the token. This is the difference between a feature and a vulnerability.
--
-- * Revocation is recorded, not deleted. `revoked_at` is the truth, and the auth session id is
--   kept so a future server-side step can map a row to Supabase's own session. Deleting the row
--   would throw away the audit trail and make "was this actually revoked?" unanswerable.
--
-- * The refresh token is never stored. Not a hash, not a prefix. The server does not need it to
--   answer "which sessions are active", and anything stored is something that can leak.
--
-- * HONEST LIMIT, documented in docs/DEVICE_SESSIONS.md as well: an already-issued access token
--   stays valid until it expires. Revoking a row prevents the *refresh* that would mint a new one,
--   so the revoked device is cut off within one access-token lifetime and cannot come back - but it
--   is not cut off the instant the button is pressed. Claiming otherwise would be a promise the
--   server does not keep.

create table if not exists public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- Random, client-generated, per browser profile. Not a fingerprint: two identical laptops are
  -- two sessions, and a browser that clears its storage is simply a new one.
  client_id text not null check (char_length(client_id) between 8 and 128),
  -- What the person needs to recognise the row. Derived from the user agent by the client and
  -- shown back to its owner only; bounded so a hostile client cannot use it as storage.
  device_label text not null default 'Неизвестное устройство'
    check (char_length(device_label) <= 80),
  platform text not null default 'Неизвестно' check (char_length(platform) <= 40),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when the session is ended. NULL means active.
  revoked_at timestamptz,
  -- Why, for the person reading their own list: 'user' for a manual sign-out, 'superseded' when a
  -- newer registration replaced the row.
  revoked_reason text check (revoked_reason is null or revoked_reason in ('user', 'superseded', 'signout')),
  -- Supabase's own session identifier, when the client knows it. Nullable on purpose: a client that
  -- cannot read it must still be able to register a session.
  auth_session_id uuid,
  constraint device_sessions_once_per_client unique (user_id, client_id)
);

-- The list is always "my active sessions, most recently seen first".
create index if not exists device_sessions_mine
  on public.device_sessions (user_id, last_seen_at desc)
  where revoked_at is null;

grant select on public.device_sessions to authenticated;
-- No insert/update/delete grant: writes go through the functions below, which enforce the rules
-- once instead of trusting every client to apply them.

alter table public.device_sessions enable row level security;

-- Reading: only your own rows. There is no policy granting anything on another person's rows, and
-- no policy for anon at all, so a foreign row is invisible rather than merely refused.
drop policy if exists device_sessions_select_own on public.device_sessions;
create policy device_sessions_select_own
  on public.device_sessions for select to authenticated
  using (user_id = auth.uid());

/**
 * Registers this browser as a live session, or refreshes the row that already exists.
 *
 * Called on sign-in and on app start. It is idempotent by `client_id`: the same browser opening the
 * app twice updates one row rather than filling the list with duplicates, which is what makes the
 * list readable in the first place.
 *
 * Two rules here are load-bearing, and both were got wrong once:
 *
 * * The auth session id is taken from the verified JWT (`auth.jwt() ->> 'session_id'`), never from a
 *   parameter. A client-supplied id is a claim about identity, and identity claims are exactly what a
 *   revoked client would lie about. When the token has no such claim the column is left alone.
 *
 * * A revoked row is NOT brought back to life by merely registering again. Registration runs on every
 *   app start, so reviving here would mean a revoked device returned the moment its owner opened the
 *   app - revocation that lasts until the next launch is not revocation. A row is only revived when
 *   it is presented with a *different* auth session id than the one that was revoked: that is a new
 *   confirmed sign-in by the auth server, which is the distinction the old version was missing. A
 *   revoked session id stays revoked, and the function reports it rather than pretending it worked.
 */
create or replace function public.device_register_session(
  p_client_id text,
  p_device_label text default null,
  p_platform text default null,
  -- Kept in the signature so an older client still calling with it does not break, but deliberately
  -- ignored: the token decides.
  p_auth_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row_id uuid;
  clean_client text := btrim(coalesce(p_client_id, ''));
  claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  token_session uuid;
  existing public.device_sessions%rowtype;
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if char_length(clean_client) < 8 or char_length(clean_client) > 128 then
    raise exception 'bad_client_id' using errcode = '22023';
  end if;

  -- The one trustworthy source of "which auth session is this". Absent for older or anonymous
  -- tokens; then it stays NULL and the row simply cannot be matched to an auth session.
  begin
    token_session := nullif(btrim(claims ->> 'session_id'), '')::uuid;
  exception when others then
    token_session := null;
  end;

  select * into existing
  from public.device_sessions s
  where s.user_id = me and s.client_id = clean_client
  for update;

  if found and existing.revoked_at is not null then
    -- Still revoked, and the caller is not presenting a new session: refuse, and say so. Raising is
    -- right because the caller must not be told it is registered when it is not.
    if token_session is null
       or existing.auth_session_id is null
       or existing.auth_session_id = token_session then
      raise exception 'session_revoked' using errcode = '28000';
    end if;
    -- A different auth session id means the auth server issued a genuinely new session after the
    -- revocation - a fresh sign-in. That is allowed to take the row over.
  end if;

  insert into public.device_sessions (user_id, client_id, device_label, platform, auth_session_id)
  values (
    me,
    clean_client,
    left(coalesce(nullif(btrim(p_device_label), ''), 'Неизвестное устройство'), 80),
    left(coalesce(nullif(btrim(p_platform), ''), 'Неизвестно'), 40),
    token_session
  )
  on conflict (user_id, client_id) do update
    set last_seen_at = now(),
        device_label = excluded.device_label,
        platform = excluded.platform,
        revoked_at = null,
        revoked_reason = null,
        auth_session_id = coalesce(excluded.auth_session_id, device_sessions.auth_session_id)
  returning id into row_id;

  return row_id;
end;
$$;

revoke all on function public.device_register_session(text, text, text, uuid) from public;
grant execute on function public.device_register_session(text, text, text, uuid) to authenticated;

/**
 * This account's sessions, newest activity first.
 *
 * Returns at most 50 rows: a list longer than that is not something a person reads, and the cap
 * keeps a client that has accumulated rows from pulling a page it cannot show.
 *
 * The current session is marked, so the screen can say "this device" and refuse to offer a
 * sign-out button that would log the reader out of the page they are reading it on.
 */
create or replace function public.device_list_sessions(p_current_client_id text default null)
returns table (
  id uuid,
  client_id text,
  device_label text,
  platform text,
  created_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  is_current boolean
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.client_id,
    s.device_label,
    s.platform,
    s.created_at,
    s.last_seen_at,
    s.revoked_at,
    (s.client_id = nullif(btrim(coalesce(p_current_client_id, '')), '')) as is_current
  from public.device_sessions s
  where s.user_id = auth.uid()
    and s.revoked_at is null
  order by s.last_seen_at desc
  limit 50;
$$;

revoke all on function public.device_list_sessions(text) from public;
grant execute on function public.device_list_sessions(text) to authenticated;

/**
 * REMOVED: these two functions used to mark rows revoked and let the screen report that devices had
 * been signed out. They did no such thing. GoTrue decides whether a refresh token is honoured by
 * looking at its own `sessions` and `refresh_tokens` tables; `public.device_sessions.revoked_at` is
 * never consulted on that path. A "sign-out" written here changed the list and left the phone signed
 * in - the worst kind of bug, because the person who pressed the button believed it worked.
 *
 * Real revocation needs the service role key (Admin API `signOut`), so it lives in the Edge Function
 * `supabase/functions/revoke-session`. Leaving a client-callable RPC that looks like revocation next
 * to the function that performs it would invite exactly the mistake this migration is fixing, so the
 * functions are dropped rather than left as decoys.
 *
 * Anything still calling them gets "function does not exist", which the client reports as
 * "not deployed" - honest, and impossible to mistake for success.
 */
drop function if exists public.device_revoke_session(uuid, text);
drop function if exists public.device_revoke_others(text);

/**
 * Whether this row is still in force, by its Supabase auth session id.
 *
 * Read this for exactly what it is: a lookup in *our* table, answering "has this row been marked
 * ended?". It is NOT the question "will Supabase still honour a refresh for this session?", and it
 * cannot be: that answer lives in GoTrue's own tables and is only changed by revoking the session
 * there (see `supabase/functions/revoke-session`).
 *
 * It stays because it is genuinely useful for deciding whether to show a row as active, and because
 * it refuses to answer about anybody else's sessions - it returns false rather than raising, so it
 * cannot be used to probe which ids exist.
 */
create or replace function public.device_session_active(p_auth_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.device_sessions s
    where s.user_id = auth.uid()
      and s.auth_session_id = p_auth_session_id
      and s.revoked_at is null
  );
$$;

revoke all on function public.device_session_active(uuid) from public;
grant execute on function public.device_session_active(uuid) to authenticated;

/**
 * Prunes rows nobody will ever look at again.
 *
 * Only rows that were revoked more than 90 days ago or were last seen more than 180 days ago. Runs
 * as the service role from the scheduled maintenance path, never from a client. Keeping a session
 * list forever would turn a convenience screen into a history of where someone has been.
 */
create or replace function public.device_sessions_prune()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  delete from public.device_sessions
    where (revoked_at is not null and revoked_at < now() - interval '90 days')
       or (revoked_at is null and last_seen_at < now() - interval '180 days');

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.device_sessions_prune() from public, anon, authenticated;

comment on table public.device_sessions is
  'Active sign-ins per account. Revocation is recorded in revoked_at; refresh tokens are never stored.';
comment on column public.device_sessions.auth_session_id is
  'Supabase auth session id, when the client could read it. Used only for device_session_active().';
