-- Nexus Messenger: create or reuse a private direct conversation safely.
-- Run once in Supabase SQL Editor.
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
  current_profile_name text;
  target_profile_name text;
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

  if existing_chat_id is not null then
    return existing_chat_id;
  end if;

  select coalesce(nullif(trim(p.display_name), ''), 'Пользователь')
    into target_profile_name from public.profiles p where p.id = target_user_id;
  select coalesce(nullif(trim(p.display_name), ''), 'Пользователь')
    into current_profile_name from public.profiles p where p.id = current_user_id;

  insert into public.chats (title, is_group, created_by)
  values (target_profile_name, false, current_user_id)
  returning id into new_chat_id;

  insert into public.chat_members (chat_id, user_id, role)
  values (new_chat_id, current_user_id, 'owner'),
         (new_chat_id, target_user_id, 'member');

  return new_chat_id;
end;
$$;

revoke all on function public.create_direct_chat(uuid) from public;
grant execute on function public.create_direct_chat(uuid) to authenticated;
