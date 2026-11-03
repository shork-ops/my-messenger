-- 20261058: «был(а) в сети» by the owner's rule, enforced in the database.
--
-- Until now the time someone was last online was a plain column of `profiles`, and any
-- signed-in account could read it for anybody. The switch «Скрывать „был(а) в сети“» was
-- stored, but nothing kept to it.
--
-- Now the column cannot be read from the table directly - `authenticated` keeps SELECT on every
-- other column of `profiles` - and the time is read through `last_seen_of`, by one rule:
--   * the owner always sees their own;
--   * with the switch on, nobody else does;
--   * with the switch off, people who share a personal chat with the owner do;
--   * nobody does across a block, in either direction, whatever the switch says;
--   * everybody else - strangers, people who only share a group - does not.
-- A hidden time comes back as null, the same answer as "never seen", and the app shows it as
-- «был(а) недавно». `visible_last_seen`, the older one-person function, follows the same rule.
--
-- The app reads the new function and falls back to the column while this file has not been
-- run. The other order does not work: a page opened before the site was updated reads the
-- column together with the names. So update the site first, run this file after, and refresh
-- the tabs that were open.
--
-- Safe to run more than once.

-- Whether the signed-in user may see when `target` was last online.
create or replace function public.may_see_last_seen(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or target is null then false
    when target = auth.uid() then true
    when public.is_blocked_between(auth.uid(), target) then false
    else coalesce((select not p.hide_last_seen from public.profiles p where p.id = target), false)
      and exists (
        select 1
        from public.chat_members mine
        join public.chat_members theirs on theirs.chat_id = mine.chat_id and theirs.user_id = target
        join public.chats c on c.id = mine.chat_id and not c.is_group and not c.is_channel
        where mine.user_id = auth.uid()
      )
  end;
$$;

revoke all on function public.may_see_last_seen(uuid) from public, anon;
grant execute on function public.may_see_last_seen(uuid) to authenticated;

-- When several people were last online, each as far as they allow. Hidden comes back as null.
create or replace function public.last_seen_of(user_ids uuid[])
returns table (id uuid, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, case when public.may_see_last_seen(p.id) then p.last_seen_at end
  from public.profiles p
  where p.id = any(coalesce(user_ids, '{}'::uuid[]))
  limit 500;
$$;

comment on function public.last_seen_of(uuid[]) is
  'Last seen times, nulled where hide_last_seen, a block or the lack of a shared personal chat does not allow the caller.';

revoke all on function public.last_seen_of(uuid[]) from public, anon;
grant execute on function public.last_seen_of(uuid[]) to authenticated;

-- The older one-person function, by the same rule.
create or replace function public.visible_last_seen(target_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.may_see_last_seen(p.id) then p.last_seen_at end
  from public.profiles p
  where p.id = target_user_id;
$$;

revoke all on function public.visible_last_seen(uuid) from public, anon;
grant execute on function public.visible_last_seen(uuid) to authenticated;

-- The column itself. PostgreSQL cannot take one column away from a table-wide grant, so every
-- column that can be read now, except this one, is granted by name. Columns closed by an earlier
-- migration (the photo and the about line, 20261057) stay closed.
do $$
declare
  readable text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into readable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name <> 'last_seen_at'
    and has_column_privilege('authenticated', 'public.profiles', column_name, 'SELECT');

  revoke select on public.profiles from anon, authenticated;
  revoke select (last_seen_at) on public.profiles from anon, authenticated;
  execute format('grant select (%s) on public.profiles to anon, authenticated', readable);
end
$$;
