-- Nexus Messenger: initial database foundation for Supabase.
-- Run this in Supabase Dashboard → SQL Editor.
-- RLS is enabled. Do not disable it for convenience.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Nexus user',
  avatar text not null default 'N',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  is_group boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  effect text check (effect is null or effect in ('sparkle', 'hearts', 'fireworks', 'glow')),
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists chat_members_user_id_idx on public.chat_members(user_id);
create index if not exists messages_chat_created_idx on public.messages(chat_id, created_at);

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

-- A user may read their own profile and profiles of people sharing a chat.
create policy "profiles_select_self_or_chatmates"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.chat_members mine
    join public.chat_members theirs on theirs.chat_id = mine.chat_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
  )
);

create policy "profiles_insert_self"
on public.profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy "profiles_update_self"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "chat_members_select_members"
on public.chat_members for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.chat_members mine
    where mine.chat_id = chat_members.chat_id and mine.user_id = (select auth.uid())
  )
);

create policy "chats_select_members"
on public.chats for select to authenticated
using (
  exists (
    select 1 from public.chat_members mine
    where mine.chat_id = chats.id and mine.user_id = (select auth.uid())
  )
);

create policy "chats_create_authenticated"
on public.chats for insert to authenticated
with check (created_by = (select auth.uid()));

create policy "chats_update_owner"
on public.chats for update to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.chat_members mine
    where mine.chat_id = chats.id and mine.user_id = (select auth.uid()) and mine.role in ('owner', 'admin')
  )
)
with check (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.chat_members mine
    where mine.chat_id = chats.id and mine.user_id = (select auth.uid()) and mine.role in ('owner', 'admin')
  )
);

create policy "chat_members_add_self_or_owner"
on public.chat_members for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.chats c
    where c.id = chat_members.chat_id and c.created_by = (select auth.uid())
  )
  or exists (
    select 1 from public.chat_members owner_member
    where owner_member.chat_id = chat_members.chat_id
      and owner_member.user_id = (select auth.uid())
      and owner_member.role in ('owner', 'admin')
  )
);

create policy "chat_members_remove_self_or_owner"
on public.chat_members for delete to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.chat_members owner_member
    where owner_member.chat_id = chat_members.chat_id
      and owner_member.user_id = (select auth.uid())
      and owner_member.role in ('owner', 'admin')
  )
);

create policy "messages_select_members"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.chat_members mine
    where mine.chat_id = messages.chat_id and mine.user_id = (select auth.uid())
  )
);

create policy "messages_insert_as_member"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.chat_members mine
    where mine.chat_id = messages.chat_id and mine.user_id = (select auth.uid())
  )
);

create policy "messages_update_own"
on public.messages for update to authenticated
using (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.chat_members mine
    where mine.chat_id = messages.chat_id and mine.user_id = (select auth.uid())
  )
)
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.chat_members mine
    where mine.chat_id = messages.chat_id and mine.user_id = (select auth.uid())
  )
);

create policy "messages_delete_own"
on public.messages for delete to authenticated
using (sender_id = (select auth.uid()));

-- Enable Realtime updates for messages (safe to run if already added).
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'Publication supabase_realtime not found; enable Realtime for public.messages in the Dashboard.';
end $$;
