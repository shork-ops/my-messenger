-- Phase 2.1: group management and two known authorization holes.
--
-- Fixes:
--   1. chats_update_admin let admins edit `created_by` (and any other column),
--      so an admin could hand a chat to a stranger.
--   2. Any admin could demote the owner: chat_members had no UPDATE policy at
--      all, so roles were only changeable through whatever policy existed —
--      the intent was "admins manage members", implemented safely below as RPCs.
--
-- The management surface is intentionally RPC-only: role changes, kicks and
-- invite rotation all have to check the actor, the target and the hierarchy in
-- one transaction, which a column-level RLS policy cannot express.

-- ---------------------------------------------------------------------------
-- 1. Protect chats from ownership and identity tampering.
-- ---------------------------------------------------------------------------
create or replace function public.chats_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'Chat id cannot be changed' using errcode = '42501';
  end if;
  if new.created_by <> old.created_by then
    raise exception 'Chat owner cannot be changed' using errcode = '42501';
  end if;
  if new.is_group <> old.is_group then
    raise exception 'Chat type cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.chats_guard_update() from public;

drop trigger if exists chats_guard_update on public.chats;
create trigger chats_guard_update
before update on public.chats
for each row execute function public.chats_guard_update();

-- Renaming a group is an admin action; the title stays the only mutable column.
drop policy if exists "chats_update_admin" on public.chats;
create policy "chats_update_admin" on public.chats
for update to authenticated using (public.is_chat_admin(id))
with check (public.is_chat_admin(id));

-- ---------------------------------------------------------------------------
-- 2. Invite lifecycle: expiry and rotation.
-- ---------------------------------------------------------------------------
alter table public.chats
  add column if not exists invite_expires_at timestamptz;

comment on column public.chats.invite_expires_at is
  'When the current invite_code stops working. Null means the code never expires.';

create or replace function public.join_group_by_invite(invite_code_input text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_chat_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if invite_code_input is null or char_length(invite_code_input) > 128 then
    raise exception 'Invalid invite link';
  end if;

  select c.id into target_chat_id
  from public.chats c
  where c.is_group = true
    and c.invite_code = invite_code_input
    and (c.invite_expires_at is null or c.invite_expires_at > now())
  limit 1;

  if target_chat_id is null then raise exception 'Invite link is invalid or expired'; end if;

  insert into public.chat_members (chat_id, user_id, role)
  values (target_chat_id, actor, 'member')
  on conflict (chat_id, user_id) do nothing;

  return target_chat_id;
end;
$$;

revoke all on function public.join_group_by_invite(text) from public;
grant execute on function public.join_group_by_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Role management.
-- ---------------------------------------------------------------------------
create or replace function public.chat_member_role(target_chat_id uuid, target_user_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select cm.role
  from public.chat_members cm
  where cm.chat_id = target_chat_id and cm.user_id = target_user_id;
$$;

revoke all on function public.chat_member_role(uuid, uuid) from public;
grant execute on function public.chat_member_role(uuid, uuid) to authenticated;

create or replace function public.set_chat_member_role(target_chat_id uuid, target_user_id uuid, new_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  target_role text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if new_role not in ('owner', 'admin', 'member') then
    raise exception 'Unknown role';
  end if;
  if target_user_id is null then raise exception 'Choose a member'; end if;

  actor_role := public.chat_member_role(target_chat_id, actor);
  if actor_role is distinct from 'owner' then
    raise exception 'Only the owner can change roles' using errcode = '42501';
  end if;

  target_role := public.chat_member_role(target_chat_id, target_user_id);
  if target_role is null then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;
  if target_user_id = actor then
    raise exception 'The owner cannot change their own role' using errcode = '42501';
  end if;

  update public.chat_members
     set role = new_role
   where chat_id = target_chat_id and user_id = target_user_id;

  return new_role;
end;
$$;

revoke all on function public.set_chat_member_role(uuid, uuid, text) from public;
grant execute on function public.set_chat_member_role(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Removing members.
-- ---------------------------------------------------------------------------
create or replace function public.remove_chat_member(target_chat_id uuid, target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  target_role text;
  chat_owner uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if target_user_id is null then raise exception 'Choose a member'; end if;

  select c.created_by into chat_owner from public.chats c where c.id = target_chat_id;
  actor_role := public.chat_member_role(target_chat_id, actor);
  target_role := public.chat_member_role(target_chat_id, target_user_id);

  if actor = target_user_id then
    -- Leaving is always allowed, except for the owner who must transfer first.
    if actor_role = 'owner' or actor = chat_owner then
      raise exception 'Transfer ownership or delete the group instead of leaving' using errcode = '42501';
    end if;
  else
    if actor_role is null or actor_role not in ('owner', 'admin') then
      raise exception 'Only admins can remove members' using errcode = '42501';
    end if;
    if target_role is null then
      raise exception 'Not a member of this chat' using errcode = '42501';
    end if;
    -- Admins must never be able to remove the owner or each other.
    if target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then
      raise exception 'Admins cannot remove the owner or other admins' using errcode = '42501';
    end if;
  end if;

  delete from public.chat_members
   where chat_id = target_chat_id and user_id = target_user_id;

  return target_user_id;
end;
$$;

revoke all on function public.remove_chat_member(uuid, uuid) from public;
grant execute on function public.remove_chat_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Invite rotation.
-- ---------------------------------------------------------------------------
create or replace function public.rotate_chat_invite(target_chat_id uuid, lifetime_hours integer default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  new_code text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not public.is_chat_admin(target_chat_id) then
    raise exception 'Only admins can rotate the invite link' using errcode = '42501';
  end if;
  if lifetime_hours is not null and (lifetime_hours < 1 or lifetime_hours > 8760) then
    raise exception 'Invite lifetime must be between 1 and 8760 hours';
  end if;

  new_code := replace(gen_random_uuid()::text, '-', '');

  update public.chats
     set invite_code = new_code,
         invite_expires_at = case
           when lifetime_hours is null then null
           else now() + make_interval(hours => lifetime_hours)
         end
   where id = target_chat_id and is_group = true;

  if not found then raise exception 'Group not found'; end if;

  return new_code;
end;
$$;

revoke all on function public.rotate_chat_invite(uuid, integer) from public;
grant execute on function public.rotate_chat_invite(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Direct DELETE through RLS must respect the same hierarchy as the RPCs.
-- ---------------------------------------------------------------------------
drop policy if exists "chat_members_remove_self_or_admin" on public.chat_members;
create policy "chat_members_remove_self_or_admin" on public.chat_members
for delete to authenticated using (
  (
    user_id = (select auth.uid())
    and role <> 'owner'
  )
  or (
    public.is_chat_admin(chat_id)
    and role = 'member'
  )
);

-- Roles are changed through set_chat_member_role only.
drop policy if exists "chat_members_update_owner" on public.chat_members;
create policy "chat_members_update_owner" on public.chat_members
for update to authenticated using (
  exists (
    select 1 from public.chat_members me
    where me.chat_id = chat_members.chat_id
      and me.user_id = (select auth.uid())
      and me.role = 'owner'
  )
)
with check (
  exists (
    select 1 from public.chat_members me
    where me.chat_id = chat_members.chat_id
      and me.user_id = (select auth.uid())
      and me.role = 'owner'
  )
);

grant update on public.chat_members to authenticated;
