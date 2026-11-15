-- Removing a conversation from one account must not delete another member's history.
-- A membership remains in place (including an owner's), but the list omits hidden rows.
alter table public.chat_members add column if not exists hidden_at timestamptz;

create or replace function public.set_chat_hidden(p_chat uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_chat is null or p_hidden is null then
    raise exception 'Invalid chat visibility';
  end if;

  update public.chat_members
  set hidden_at = case when p_hidden then now() else null end
  where chat_id = p_chat and user_id = (select auth.uid());

  if not found then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.set_chat_hidden(uuid, boolean) from public;
grant execute on function public.set_chat_hidden(uuid, boolean) to authenticated;
