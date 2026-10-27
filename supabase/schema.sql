-- Nexus Messenger Supabase foundation.
-- Run once in Supabase Dashboard -> SQL Editor. Do not disable RLS.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Nexus user' check (char_length(display_name) between 1 and 60),
  avatar text not null default 'N',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  is_group boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (chat_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  body text not null default '',
  attachment jsonb,
  effect text check (effect is null or effect in ('sparkle','hearts','fireworks','glow')),
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint messages_body_length check (char_length(body) <= 10000),
  constraint messages_not_empty check (char_length(body) > 0 or attachment is not null)
);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id,user_id,emoji)
);

create index if not exists chat_members_user_id_idx on public.chat_members(user_id, joined_at desc);
create index if not exists messages_chat_created_idx on public.messages(chat_id, created_at desc);
create index if not exists message_reactions_user_id_idx on public.message_reactions(user_id);

-- SECURITY DEFINER helpers prevent recursive policies on chat_members.
create or replace function public.is_chat_member(target_chat_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat_id and cm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_chat_admin(target_chat_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat_id
      and cm.user_id = (select auth.uid())
      and cm.role in ('owner','admin')
  );
$$;

revoke all on function public.is_chat_member(uuid) from public;
revoke all on function public.is_chat_admin(uuid) from public;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.is_chat_admin(uuid) to authenticated;

create or replace function public.handle_new_nexus_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Nexus user'),
    upper(left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'N'), 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_nexus on auth.users;
create trigger on_auth_user_created_nexus after insert on auth.users
for each row execute procedure public.handle_new_nexus_user();

create or replace function public.set_nexus_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.set_nexus_updated_at();
drop trigger if exists chats_updated_at on public.chats;
create trigger chats_updated_at before update on public.chats
for each row execute procedure public.set_nexus_updated_at();

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

-- Signed-in users can discover profiles; edits are restricted to the profile owner.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
for select to authenticated using (true);
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "chats_select_members" on public.chats;
create policy "chats_select_members" on public.chats
for select to authenticated using (public.is_chat_member(id));
drop policy if exists "chats_insert_creator" on public.chats;
create policy "chats_insert_creator" on public.chats
for insert to authenticated with check (created_by = (select auth.uid()));
drop policy if exists "chats_update_admin" on public.chats;
create policy "chats_update_admin" on public.chats
for update to authenticated using (public.is_chat_admin(id))
with check (public.is_chat_admin(id));
drop policy if exists "chats_delete_creator" on public.chats;
create policy "chats_delete_creator" on public.chats
for delete to authenticated using (created_by = (select auth.uid()));

drop policy if exists "chat_members_select_members" on public.chat_members;
create policy "chat_members_select_members" on public.chat_members
for select to authenticated using (public.is_chat_member(chat_id));
-- Safe first-stage policy: a chat creator may add only their own owner membership.
-- Inviting other users should be implemented through a validated RPC/Edge Function.
drop policy if exists "chat_members_add_self_or_owner" on public.chat_members;
drop policy if exists "chat_members_insert_creator_as_owner" on public.chat_members;
create policy "chat_members_insert_creator_as_owner" on public.chat_members
for insert to authenticated with check (
  user_id = (select auth.uid())
  and role = 'owner'
  and exists (select 1 from public.chats c
    where c.id = chat_id and c.created_by = (select auth.uid()))
);
drop policy if exists "chat_members_remove_self_or_admin" on public.chat_members;
create policy "chat_members_remove_self_or_admin" on public.chat_members
for delete to authenticated using (
  user_id = (select auth.uid()) or public.is_chat_admin(chat_id)
);

drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members" on public.messages
for select to authenticated using (public.is_chat_member(chat_id));
drop policy if exists "messages_insert_as_member" on public.messages;
create policy "messages_insert_as_member" on public.messages
for insert to authenticated with check (
  sender_id = (select auth.uid()) and public.is_chat_member(chat_id)
);
drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
for update to authenticated using (
  sender_id = (select auth.uid()) and public.is_chat_member(chat_id)
) with check (
  sender_id = (select auth.uid()) and public.is_chat_member(chat_id)
);
drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages
for delete to authenticated using (
  sender_id = (select auth.uid()) and public.is_chat_member(chat_id)
);

drop policy if exists "reactions_select_chat_members" on public.message_reactions;
create policy "reactions_select_chat_members" on public.message_reactions
for select to authenticated using (
  exists (select 1 from public.messages m
    where m.id = message_id and public.is_chat_member(m.chat_id))
);
drop policy if exists "reactions_insert_self" on public.message_reactions;
create policy "reactions_insert_self" on public.message_reactions
for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.messages m
    where m.id = message_id and public.is_chat_member(m.chat_id))
);
drop policy if exists "reactions_delete_self" on public.message_reactions;
create policy "reactions_delete_self" on public.message_reactions
for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.chats to authenticated;
grant select, insert, delete on public.chat_members to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;

-- Realtime: make chat messages/reactions available to subscribers. RLS still applies.
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
