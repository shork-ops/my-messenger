-- Channels.
--
-- A channel is a chat where the owner and its authors write and everyone else reads. The
-- whole feature rests on one rule being enforced by the database rather than by the client:
-- a subscriber must not be able to post, even with a modified browser.
--
-- Nothing new is created for the channel itself. It is a row in the same chats table with a
-- flag, so every existing feature - history, search, media, receipts - keeps working.

alter table public.chats
  add column if not exists is_channel boolean not null default false,
  -- The channel's own look: accent colour, cover image, pinned message. Kept as jsonb so a
  -- design tweak does not need a migration; the client refuses unsafe values on both ends.
  add column if not exists channel_design jsonb,
  add column if not exists description text;

alter table public.chat_members
  add column if not exists channel_role text
    check (channel_role is null or channel_role in ('owner', 'author', 'subscriber'));

-- Reading a channel is open to subscribers; writing is not. The role is on the membership
-- row, so one lookup answers both questions.
create or replace function public.can_post_to_chat(target_chat uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_members m
    join public.chats c on c.id = m.chat_id
    where m.chat_id = target_chat
      and m.user_id = target_user
      and (
        -- An ordinary chat: any member writes.
        not c.is_channel
        -- A channel: only its owner and authors.
        or m.channel_role in ('owner', 'author')
        -- Existing admins of a channel keep their ability to post, or promoting someone
        -- to admin would quietly take their voice away. The role lives in the `role`
        -- column, which already existed; there is no separate admin flag, and referring
        -- to one made this migration fail on a database that had run the others.
        or m.role = 'owner'
      )
  );
$$;

grant execute on function public.can_post_to_chat(uuid, uuid) to authenticated;

-- Writing into a chat now also asks whether this member may write at all.
drop policy if exists "messages_insert_as_member" on public.messages;
create policy "messages_insert_as_member" on public.messages
for insert to authenticated with check (
  sender_id = (select auth.uid())
  and public.is_chat_member(chat_id)
  and public.can_post_to_chat(chat_id, (select auth.uid()))
  and (send_at is null or (send_at > now() and send_at < now() + interval '1 year'))
);

-- Reactions and receipts are also writing, and a muted subscriber must not be able to make
-- themselves heard through them.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'message_reactions') then
    execute 'drop policy if exists "reactions insert own" on public.message_reactions';
    execute $p$
      create policy "reactions insert own" on public.message_reactions
      for insert to authenticated with check (
        user_id = (select auth.uid())
        and exists (
          select 1 from public.messages m
          where m.id = message_reactions.message_id
            and public.can_post_to_chat(m.chat_id, (select auth.uid()))
        )
      )
    $p$;
  end if;
end $$;

-- The design is written by the channel's owner only. Parsing lives in the client, but the
-- database refuses values that are not the right shape at all.
create or replace function public.channel_design_is_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select value is null
    or (
      jsonb_typeof(value) = 'object'
      and (not value ? 'accent' or value->>'accent' ~ '^#[0-9a-fA-F]{6}$')
      and (not value ? 'cover' or value->>'cover' ~* '^https?://')
    );
$$;

alter table public.chats
  drop constraint if exists chats_channel_design_check;
alter table public.chats
  add constraint chats_channel_design_check check (public.channel_design_is_valid(channel_design));

-- Channels have a handle so they can be found and joined from a link. Chats never had a
-- name to look up; a channel does, and two channels answering to the same handle would make
-- an invite ambiguous.
alter table public.chats
  add column if not exists handle text check (handle is null or handle ~ '^[a-z0-9_]{3,32}');

create unique index if not exists chats_channel_handle_key
  on public.chats (handle)
  where is_channel and handle is not null;

-- Finding a channel by its handle without being a member yet: the caller cannot read the
-- chats row, so the lookup is done in a function that returns only what the join screen needs.
create or replace function public.find_channel(channel_handle text)
returns table (id uuid, title text, description text, channel_design jsonb, members bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.title, c.description, c.channel_design,
         (select count(*) from public.chat_members m where m.chat_id = c.id)
  from public.chats c
  where c.is_channel
    and c.handle = lower(channel_handle)
  limit 1;
$$;

grant execute on function public.find_channel(text) to authenticated;

-- Joining: anyone signed in may subscribe to a channel they can name. A chat has no such
-- door, which is why this is a function rather than a loosened insert policy.
create or replace function public.subscribe_to_channel(channel_handle text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  select c.id into target from public.chats c
  where c.is_channel and c.handle = lower(channel_handle);
  if target is null then
    raise exception 'channel not found';
  end if;
  insert into public.chat_members (chat_id, user_id, channel_role)
  values (target, auth.uid(), 'subscriber')
  on conflict (chat_id, user_id) do nothing;
  return target;
end;
$fn$;

grant execute on function public.subscribe_to_channel(text) to authenticated;

-- Leaving keeps the history: the messages stay readable to whoever remains, and the
-- subscriber loses only their place in the channel.
create or replace function public.unsubscribe_from_channel(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from public.chat_members
  where chat_id = target_chat
    and user_id = auth.uid()
    and coalesce(channel_role, 'subscriber') = 'subscriber';
end;
$fn$;

grant execute on function public.unsubscribe_from_channel(uuid) to authenticated;
