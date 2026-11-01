-- 20261054: the devices signed in to an account, and ending one of them.
--
-- Supabase records every sign-in as a row in auth.sessions, but that schema is closed to
-- the app. These two functions open the caller's own rows and nothing else: they run with
-- the owner's rights (security definer) and every statement is pinned to auth.uid().
--
-- Ending a session deletes its row; the refresh tokens go with it (on delete cascade), so
-- that device cannot renew its sign-in. Its current access token still works until it
-- expires - up to an hour with the default settings - which is what Supabase's own
-- "sign out everywhere else" does too. The app says so in plain words.
--
-- Safe to run more than once.

create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, last_active timestamptz, user_agent text, ip text, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.created_at,
         -- refreshed_at is stored without a time zone, in UTC; greatest() skips nulls.
         greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'utc'),
         s.user_agent,
         host(s.ip),
         coalesce(s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid, false)
  from auth.sessions s
  where s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > now())
  order by 6 desc, 3 desc nulls last
$$;

-- The session this request came from is never ended here: leaving this device is the
-- ordinary "Выйти", which also clears what the browser keeps.
create or replace function public.end_session(target uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with gone as (
    delete from auth.sessions s
    where s.id = target
      and s.user_id = auth.uid()
      and s.id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid
    returning 1
  )
  select exists (select 1 from gone)
$$;

revoke all on function public.my_sessions() from public, anon;
revoke all on function public.end_session(uuid) from public, anon;
grant execute on function public.my_sessions() to authenticated;
grant execute on function public.end_session(uuid) to authenticated;

-- Stops here, with a clear error, if this project's owner cannot read sign-ins -
-- rather than leaving functions that fail later inside the app.
do $$ begin perform 1 from auth.sessions limit 1; end $$;
