-- Enforce the visibility rules where they matter.
--
-- Storing a setting and then not checking it is worse than not offering it: the
-- person believes they are hidden. Both the search and the chat creation have to
-- consult the profile, so the rules are applied in SQL - a modified client cannot
-- skip them.

-- Search: hidden profiles never come back.
create or replace function public.search_profiles(term text)
returns table (id uuid, username text, display_name text, avatar text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar, p.avatar_path
  from public.profiles p
  where p.username is not null
    and p.username ilike (term || '%')
    and p.id <> auth.uid()
    and p.profile_visibility <> 'nobody'
  order by p.username
  limit 8;
$$;

comment on function public.search_profiles is
  'Username search that respects the profile_visibility setting.';

grant execute on function public.search_profiles(text) to authenticated;

-- Chat creation: a stranger may not open a conversation with someone who accepts
-- messages only from people they already know.
create or replace function public.create_direct_chat(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_chat_id uuid;
  new_chat_id uuid;
  target_profile_name text;
  current_display text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if target_user_id is null or target_user_id = current_user_id then
    raise exception 'Choose another user';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_user_id and p.username is not null) then
    raise exception 'User not found';
  end if;

  select c.id into existing_chat_id
  from public.chats c
  where c.is_group = false
    and exists (select 1 from public.chat_members a where a.chat_id = c.id and a.user_id = current_user_id)
    and exists (select 1 from public.chat_members b where b.chat_id = c.id and b.user_id = target_user_id)
    and (select count(*) from public.chat_members m where m.chat_id = c.id) = 2
  order by c.created_at asc
  limit 1;

  -- An existing conversation stays usable even if the policy was tightened later:
  -- silently losing an open chat would be worse than the policy is worth.
  if existing_chat_id is not null then
    return existing_chat_id;
  end if;

  if not public.may_message(target_user_id) then
    raise exception 'This user does not accept new chats';
  end if;

  select coalesce(nullif(trim(p.display_name), ''), 'Пользователь')
    into target_profile_name from public.profiles p where p.id = target_user_id;
  select coalesce(nullif(trim(p.display_name), ''), 'Пользователь')
    into current_display from public.profiles p where p.id = current_user_id;

  insert into public.chats (title, is_group, created_by)
  values (target_profile_name, false, current_user_id)
  returning id into new_chat_id;

  insert into public.chat_members (chat_id, user_id, role)
  values (new_chat_id, current_user_id, 'owner'), (new_chat_id, target_user_id, 'member');

  return new_chat_id;
end;
$$;

comment on function public.create_direct_chat is
  'Opens a direct chat if the target accepts new conversations, else raises.';

grant execute on function public.create_direct_chat(uuid) to authenticated;
