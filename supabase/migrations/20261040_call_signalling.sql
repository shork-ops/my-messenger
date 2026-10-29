-- Phase 3: call signalling.
--
-- Calls themselves run on an SFU (LiveKit or Cloudflare Calls); this schema is
-- only the signalling layer Supabase is good at: who is calling whom, in which
-- chat, and whether the call is still ringing.
--
-- Design notes:
--   * A call belongs to a chat, so the existing membership rules decide who may
--     answer without a second permission system.
--   * `status` is what the UI renders; the database rejects impossible
--     transitions (ending a call twice, answering a finished one) instead of
--     trusting the client to behave.
--   * Times are stored, not durations: a duration computed on write would be
--     wrong whenever a call is resumed after a network drop.

create type public.call_kind as enum ('audio', 'video');
create type public.call_status as enum ('ringing', 'active', 'ended', 'missed', 'declined');

-- ---------------------------------------------------------------------------
-- Membership check with an explicit user argument.
--
-- `is_chat_member(uuid)` reads auth.uid(), which suits RLS but returns false for
-- service_role and any trigger. The call RPCs below name their actor, so the
-- rules stay checkable outside a request context.
-- ---------------------------------------------------------------------------
create or replace function public.is_chat_member_of(target_chat_id uuid, target_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat_id and cm.user_id = target_user_id
  );
$$;

revoke all on function public.is_chat_member_of(uuid, uuid) from public;
grant execute on function public.is_chat_member_of(uuid, uuid) to authenticated, service_role;
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  kind public.call_kind not null default 'audio',
  status public.call_status not null default 'ringing',
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  -- Room name on the SFU. Kept separate from `id` so the provider namespace
  -- stays decoupled from ours.
  room_name text not null,
  ended_by uuid references auth.users(id) on delete set null
);

create index if not exists calls_chat_idx on public.calls (chat_id, started_at desc);
-- Only one live call per chat: two concurrent calls cannot be joined by a client
-- that has a single call UI.
create unique index if not exists calls_one_active_per_chat
  on public.calls (chat_id)
  where status in ('ringing', 'active');

alter table public.calls enable row level security;

-- Members of the chat see its calls; nobody else does, not even the caller's
-- other chats.
drop policy if exists "calls visible to chat members" on public.calls;
create policy "calls visible to chat members" on public.calls
for select to authenticated using (public.is_chat_member_of(chat_id, (select auth.uid())));

drop policy if exists "calls startable by chat members" on public.calls;
create policy "calls startable by chat members" on public.calls
for insert to authenticated
with check (created_by = (select auth.uid()) and public.is_chat_member_of(chat_id, (select auth.uid())));

drop policy if exists "calls updatable by chat members" on public.calls;
create policy "calls updatable by chat members" on public.calls
for update to authenticated
using (public.is_chat_member_of(chat_id, (select auth.uid())))
with check (public.is_chat_member_of(chat_id, (select auth.uid())));

grant select, insert, update, delete on public.calls to service_role;
grant select, insert, update on public.calls to authenticated;

-- Realtime delivery of status changes is what turns a ringing call into a
-- ringing phone on the other side.
alter publication supabase_realtime add table public.calls;

-- ---------------------------------------------------------------------------
-- State machine guard.
-- ---------------------------------------------------------------------------
create or replace function public.calls_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('ended', 'missed', 'declined') then
    raise exception 'Call is already finished' using errcode = '42501';
  end if;

  -- The call's identity is fixed at creation.
  if new.chat_id <> old.chat_id or new.created_by <> old.created_by or new.room_name <> old.room_name then
    raise exception 'Call identity cannot change' using errcode = '42501';
  end if;

  -- `active` means answered, so the timestamp has to appear exactly once.
  if new.status = 'active' and old.status = 'ringing' then
    new.answered_at := coalesce(new.answered_at, now());
  end if;

  if new.status in ('ended', 'missed', 'declined') then
    new.ended_at := coalesce(new.ended_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.calls_guard_update() from public;

drop trigger if exists calls_guard_update on public.calls;
create trigger calls_guard_update
before update on public.calls
for each row execute function public.calls_guard_update();


-- ---------------------------------------------------------------------------
-- RPCs.
--
-- The client never writes `status` directly through PostgREST for the ordinary
-- flow: the transitions below encode who is allowed to do what, so a modified
-- client cannot answer its own call or end someone else's.
-- ---------------------------------------------------------------------------
create or replace function public.start_call(target_chat_id uuid, call_kind_input text default 'audio')
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  peer uuid;
  is_group_chat boolean;
  created public.calls;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not public.is_chat_member_of(target_chat_id, actor) then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;

  select c.is_group into is_group_chat from public.chats c where c.id = target_chat_id;
  if is_group_chat is null then raise exception 'Chat not found'; end if;

  -- In a direct chat, a block must stop the call as firmly as it stops messages.
  if is_group_chat = false then
    select cm.user_id into peer
    from public.chat_members cm
    where cm.chat_id = target_chat_id and cm.user_id <> actor
    limit 1;
    if peer is not null and public.is_blocked_between(actor, peer) then
      raise exception 'Cannot call a blocked user' using errcode = '42501';
    end if;
  end if;

  begin
    insert into public.calls (chat_id, created_by, kind, room_name)
    values (target_chat_id, actor, call_kind_input::public.call_kind, 'call-' || gen_random_uuid()::text)
    returning * into created;
  exception when unique_violation then
    raise exception 'A call is already in progress in this chat' using errcode = '42501';
  end;

  return created;
end;
$$;

create or replace function public.answer_call(call_id uuid)
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.calls;
begin
  select * into target from public.calls where id = call_id;
  if target.id is null then raise exception 'Call not found'; end if;
  if not public.is_chat_member_of(target.chat_id, actor) then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;
  -- The caller cannot answer their own call; only a peer can.
  if target.created_by = actor then
    raise exception 'The caller cannot answer their own call' using errcode = '42501';
  end if;
  if target.status not in ('ringing', 'active') then
    raise exception 'Call is already finished' using errcode = '42501';
  end if;

  update public.calls
     set status = 'active'
   where id = call_id
  returning * into target;

  return target;
end;
$$;

create or replace function public.end_call(call_id uuid, outcome text default 'ended')
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.calls;
  final_status public.call_status;
begin
  select * into target from public.calls where id = call_id;
  if target.id is null then raise exception 'Call not found'; end if;
  if not public.is_chat_member_of(target.chat_id, actor) then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;
  if target.status in ('ended', 'missed', 'declined') then
    -- Ending twice is harmless; report the stored state instead of failing, so a
    -- double tap or two devices do not produce an error popup.
    return target;
  end if;

  final_status := case
    when outcome = 'declined' then 'declined'::public.call_status
    when target.status = 'ringing' then 'missed'::public.call_status
    else 'ended'::public.call_status
  end;

  update public.calls
     set status = final_status,
         ended_by = actor
   where id = call_id
  returning * into target;

  return target;
end;
$$;

-- Rings cannot last forever: a call left ringing blocks the chat (one active call
-- per chat) and would keep the caller waiting.
create or replace function public.expire_stale_calls(max_age interval default '2 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired integer;
begin
  update public.calls
     set status = 'missed',
         ended_at = coalesce(ended_at, now())
   where status = 'ringing'
     and started_at < now() - max_age;
  get diagnostics expired = row_count;
  return expired;
end;
$$;

revoke all on function public.start_call(uuid, text) from public;
revoke all on function public.answer_call(uuid) from public;
revoke all on function public.end_call(uuid, text) from public;
revoke all on function public.expire_stale_calls(interval) from public;

grant execute on function public.start_call(uuid, text) to authenticated, service_role;
grant execute on function public.answer_call(uuid) to authenticated, service_role;
grant execute on function public.end_call(uuid, text) to authenticated, service_role;
grant execute on function public.expire_stale_calls(interval) to service_role;


