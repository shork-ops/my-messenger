-- Phase 2.6: privacy controls.
--
-- Three user-facing switches and one account-level operation:
--   * block another user, which stops direct chats and hides each other;
--   * hide "last seen";
--   * turn read receipts off (the sender then sees only "sent");
--   * delete the account and every row that belongs to it.
--
-- Preferences live on the profile so they follow the user across devices. The
-- defaults keep today's behaviour: nothing is hidden until the user asks.

alter table public.profiles
  add column if not exists hide_last_seen boolean not null default false,
  add column if not exists disable_read_receipts boolean not null default false;

comment on column public.profiles.hide_last_seen is
  'When true, peers see "недавно" instead of the exact last seen time.';
comment on column public.profiles.disable_read_receipts is
  'When true, this user does not report reads and sees no read receipts.';

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own" on public.user_blocks
for select to authenticated using (blocker_id = (select auth.uid()));

drop policy if exists "user_blocks_manage_own" on public.user_blocks;
create policy "user_blocks_manage_own" on public.user_blocks
for insert to authenticated with check (blocker_id = (select auth.uid()));

drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks
for delete to authenticated using (blocker_id = (select auth.uid()));

create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

revoke all on public.user_blocks from anon;
grant select, insert, delete on public.user_blocks to authenticated;

-- ---------------------------------------------------------------------------
-- Block check, in both directions: a block hides the relationship from both
-- users, so neither can keep talking into a void.
-- ---------------------------------------------------------------------------
create or replace function public.is_blocked_between(user_a uuid, user_b uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = user_a and b.blocked_id = user_b)
       or (b.blocker_id = user_b and b.blocked_id = user_a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

create or replace function public.block_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if target_user_id = actor then raise exception 'You cannot block yourself'; end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (actor, target_user_id)
  on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

create or replace function public.unblock_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required'; end if;
  delete from public.user_blocks where blocker_id = actor and blocked_id = target_user_id;
end;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Messages cannot be inserted into a direct chat while a block exists.
-- Group chats are unaffected: leaving a group is the answer there.
-- ---------------------------------------------------------------------------
create or replace function public.messages_guard_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_group_chat boolean;
  peer uuid;
begin
  select c.is_group into is_group_chat from public.chats c where c.id = new.chat_id;
  if is_group_chat is distinct from false then return new; end if;

  select cm.user_id into peer
  from public.chat_members cm
  where cm.chat_id = new.chat_id and cm.user_id <> new.sender_id
  limit 1;

  if peer is not null and public.is_blocked_between(new.sender_id, peer) then
    raise exception 'Cannot send messages to a blocked user' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.messages_guard_block() from public;

drop trigger if exists messages_guard_block on public.messages;
create trigger messages_guard_block
before insert on public.messages
for each row execute function public.messages_guard_block();

-- ---------------------------------------------------------------------------
-- Direct chat creation must refuse blocked pairs.
-- ---------------------------------------------------------------------------
create or replace function public.start_direct_chat(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  existing uuid;
  created uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if target_user_id = actor then raise exception 'Cannot start a chat with yourself'; end if;
  if not exists (select 1 from public.profiles p where p.id = target_user_id) then
    raise exception 'User not found';
  end if;
  if public.is_blocked_between(actor, target_user_id) then
    raise exception 'This user is not available' using errcode = '42501';
  end if;

  select c.id into existing
  from public.chats c
  join public.chat_members a on a.chat_id = c.id and a.user_id = actor
  join public.chat_members b on b.chat_id = c.id and b.user_id = target_user_id
  where c.is_group = false
  limit 1;

  if existing is not null then return existing; end if;

  insert into public.chats (title, is_group, created_by)
  values ('', false, actor)
  returning id into created;

  insert into public.chat_members (chat_id, user_id, role)
  values (created, actor, 'owner'), (created, target_user_id, 'member');

  return created;
end;
$$;

revoke all on function public.start_direct_chat(uuid) from public;
grant execute on function public.start_direct_chat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Last seen respects the visibility switch.
-- ---------------------------------------------------------------------------
create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then return; end if;
  update public.profiles set last_seen_at = now() where id = actor;
end;
$$;

revoke all on function public.touch_last_seen() from public;
grant execute on function public.touch_last_seen() to authenticated;

-- Peers read "recently" when the switch is on: null timestamps are exactly
-- that signal, so the client needs no extra column.
create or replace function public.visible_last_seen(target_user_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  hidden boolean;
  seen timestamptz;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if public.is_blocked_between(actor, target_user_id) then return null; end if;

  select p.hide_last_seen, p.last_seen_at into hidden, seen
  from public.profiles p where p.id = target_user_id;

  if hidden is null then return null; end if;
  if hidden then return null; end if;
  return seen;
end;
$$;

revoke all on function public.visible_last_seen(uuid) from public;
grant execute on function public.visible_last_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion.
--
-- Messages the user sent are kept as tombstones so conversations do not lose
-- their shape: the row stays, the body is emptied and the sender is detached
-- from auth.users by the cascade. Everything genuinely private is removed.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  owned_chat record;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  -- Groups the user owns lose their owner; hand them to the oldest remaining
  -- admin (or member) so the chat is not left unmanageable.
  --
  -- chats_guard_update freezes created_by, so the transfer needs the trigger
  -- disabled for these maintenance statements.
  alter table public.chats disable trigger chats_guard_update;
  for owned_chat in
    select c.id from public.chats c
    where c.created_by = actor and c.is_group = true
  loop
    declare
      successor uuid;
    begin
      select cm.user_id into successor
      from public.chat_members cm
      where cm.chat_id = owned_chat.id and cm.user_id <> actor
      order by case cm.role when 'admin' then 0 else 1 end, cm.joined_at
      limit 1;

      if successor is null then
        delete from public.chats where id = owned_chat.id;
      else
        update public.chat_members set role = 'owner'
        where chat_id = owned_chat.id and user_id = successor;
        update public.chats set created_by = successor where id = owned_chat.id;
      end if;
    end;
  end loop;
  alter table public.chats enable trigger chats_guard_update;

  -- Empty the user's messages but keep them as placeholders.
  update public.messages
     set body = '', attachment = null, deleted_at = coalesce(deleted_at, now())
   where sender_id = actor;

  delete from public.message_reactions where user_id = actor;
  delete from public.push_subscriptions where user_id = actor;
  delete from public.chat_members where user_id = actor;
  delete from public.user_blocks where blocker_id = actor or blocked_id = actor;
  delete from public.profiles where id = actor;

  -- auth.users is removed by the caller (Edge Function `delete-account`), which
  -- owns the service role key. Doing it here would require elevated rights
  -- inside a user-facing RPC.
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
