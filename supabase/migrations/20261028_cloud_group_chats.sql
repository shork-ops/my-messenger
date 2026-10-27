-- Cloud group chats and secure invite links.
-- Run after schema.sql and the existing migrations in Supabase SQL Editor.

alter table public.chats
  add column if not exists invite_code text;

create unique index if not exists chats_invite_code_unique_idx
  on public.chats (invite_code)
  where invite_code is not null;

create or replace function public.create_group_chat(group_title text)
returns table(chat_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  new_chat_id uuid;
  new_invite_code text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if group_title is null or char_length(trim(group_title)) < 1 or char_length(trim(group_title)) > 100 then
    raise exception 'Group name must be between 1 and 100 characters';
  end if;

  new_invite_code := encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.chats (title, is_group, created_by, invite_code)
  values (trim(group_title), true, actor, new_invite_code)
  returning id into new_chat_id;

  insert into public.chat_members (chat_id, user_id, role)
  values (new_chat_id, actor, 'owner');

  return query select new_chat_id, new_invite_code;
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
  where c.is_group = true and c.invite_code = invite_code_input
  limit 1;

  if target_chat_id is null then raise exception 'Invite link is invalid or expired'; end if;

  insert into public.chat_members (chat_id, user_id, role)
  values (target_chat_id, actor, 'member')
  on conflict (chat_id, user_id) do nothing;

  return target_chat_id;
end;
$$;

revoke all on function public.create_group_chat(text) from public;
revoke all on function public.join_group_by_invite(text) from public;
grant execute on function public.create_group_chat(text) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;
