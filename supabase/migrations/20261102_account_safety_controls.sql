-- P0 account safety: block list, user reports, and revocable/expiring group invites.
-- Apply after 20261028_cloud_group_chats.sql and security hardening.
begin;

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete set null,
  reason text not null check (reason in ('spam','harassment','impersonation','inappropriate_content','other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  constraint user_reports_not_self check (reporter_id <> reported_user_id)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id);
create index if not exists user_reports_status_created_idx on public.user_reports(status, created_at desc);

alter table public.chats add column if not exists invite_expires_at timestamptz;
alter table public.chats add column if not exists invite_revoked_at timestamptz;

alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;

revoke all on public.user_blocks, public.user_reports from anon, authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant insert on public.user_reports to authenticated;

drop policy if exists user_blocks_select_own on public.user_blocks;
create policy user_blocks_select_own on public.user_blocks
for select to authenticated using (blocker_id = (select auth.uid()));
drop policy if exists user_blocks_insert_own on public.user_blocks;
create policy user_blocks_insert_own on public.user_blocks
for insert to authenticated with check (
  blocker_id = (select auth.uid())
  and blocked_id <> (select auth.uid())
);
drop policy if exists user_blocks_delete_own on public.user_blocks;
create policy user_blocks_delete_own on public.user_blocks
for delete to authenticated using (blocker_id = (select auth.uid()));

-- Reports can be submitted by the reporter but never read/edited by ordinary users.
drop policy if exists user_reports_insert_own on public.user_reports;
create policy user_reports_insert_own on public.user_reports
for insert to authenticated with check (
  reporter_id = (select auth.uid())
  and reported_user_id <> (select auth.uid())
  and (chat_id is null or public.is_chat_member(chat_id))
);

create or replace function public.rotate_group_invite(
  target_chat_id uuid,
  expires_in_hours integer default 168
)
returns table(invite_code text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  new_code text;
  new_expiry timestamptz;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if expires_in_hours is null or expires_in_hours < 1 or expires_in_hours > 8760 then
    raise exception 'Expiry must be between 1 hour and 365 days';
  end if;

  if not exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat_id
      and cm.user_id = actor
      and cm.role in ('owner','admin')
  ) then
    raise exception 'Only group admins can rotate invites';
  end if;

  new_code := replace(gen_random_uuid()::text, '-', '');
  new_expiry := now() + make_interval(hours => expires_in_hours);

  update public.chats c
  set invite_code = new_code,
      invite_expires_at = new_expiry,
      invite_revoked_at = null
  where c.id = target_chat_id and c.is_group = true;

  if not found then raise exception 'Group chat not found'; end if;
  return query select new_code, new_expiry;
end;
$$;

create or replace function public.revoke_group_invite(target_chat_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat_id
      and cm.user_id = actor
      and cm.role in ('owner','admin')
  ) then
    raise exception 'Only group admins can revoke invites';
  end if;

  update public.chats
  set invite_revoked_at = now(), invite_code = null, invite_expires_at = null
  where id = target_chat_id and is_group = true;

  return found;
end;
$$;

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
    and c.invite_revoked_at is null
    and (c.invite_expires_at is null or c.invite_expires_at > now())
  limit 1;

  if target_chat_id is null then raise exception 'Invite link is invalid, expired, or revoked'; end if;

  insert into public.chat_members (chat_id, user_id, role)
  values (target_chat_id, actor, 'member')
  on conflict (chat_id, user_id) do nothing;

  return target_chat_id;
end;
$$;

revoke all on function public.rotate_group_invite(uuid, integer) from public, anon;
revoke all on function public.revoke_group_invite(uuid) from public, anon;
revoke all on function public.join_group_by_invite(text) from public, anon;
grant execute on function public.rotate_group_invite(uuid, integer) to authenticated;
grant execute on function public.revoke_group_invite(uuid) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;

commit;
