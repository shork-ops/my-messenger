-- 20261057: who sees the profile photo and the "about" line.
--
-- Three answers, the same ones the big messengers give: everyone, my contacts, nobody.
--
-- "My contacts" needs a definition, because the app has no address book. A contact here is
-- someone you have written to in a personal chat. Merely sharing a chat is not enough: anyone
-- may open a personal chat with a person who accepts strangers, and a group can hold hundreds
-- of people nobody chose. Writing back is the moment a stranger becomes someone you talk to.
--
-- A setting that is only stored would be a decoration, so the rule is enforced in the
-- database, in three places:
--   * the two columns can no longer be read from the table directly - `authenticated` keeps
--     SELECT on every other column of `profiles`, and the photo and the text are read through
--     `profile_details`, which answers with nothing when the owner said no;
--   * the username search hands out the photo by the same rule;
--   * the avatars bucket checks the same rule, so a hidden photo cannot be fetched by
--     listing the owner's folder or by reusing a path learned earlier either.
-- A block hides both, in both directions, whatever the setting says. The owner always sees
-- their own.
--
-- The app reads the new function and falls back to the old columns while this migration has
-- not been run, so the order of deploying the site and running this file does not matter.
--
-- Safe to run more than once.

alter table public.profiles
  add column if not exists details_visibility text not null default 'everyone';

alter table public.profiles
  drop constraint if exists profiles_details_visibility_check,
  add constraint profiles_details_visibility_check
    check (details_visibility in ('everyone', 'contacts', 'nobody'));

comment on column public.profiles.details_visibility is
  'Who sees the profile photo and the about line: everyone, contacts (people this user has written to in a personal chat), or nobody.';

-- Whether `author` has written to `reader` in a personal chat. A message scheduled for later
-- does not count until it is delivered: the reader has not received anything yet.
create or replace function public.has_written_to(author uuid, reader uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_members mine
    join public.chat_members theirs on theirs.chat_id = mine.chat_id and theirs.user_id = reader
    join public.chats c on c.id = mine.chat_id and c.is_group = false
    where mine.user_id = author
      and exists (
        select 1 from public.messages m
        where m.chat_id = mine.chat_id
          and m.sender_id = author
          and (m.send_at is null or m.send_at <= now())
      )
  );
$$;

revoke all on function public.has_written_to(uuid, uuid) from public, anon, authenticated;

-- Whether the signed-in user may see the photo and the about line of `target`.
create or replace function public.may_see_profile_details(target uuid)
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
    else coalesce(
      (
        select case p.details_visibility
          when 'everyone' then true
          when 'contacts' then public.has_written_to(target, auth.uid())
          else false
        end
        from public.profiles p
        where p.id = target
      ),
      false
    )
  end;
$$;

revoke all on function public.may_see_profile_details(uuid) from public, anon;
grant execute on function public.may_see_profile_details(uuid) to authenticated;

-- The photo and the about line of several people at once, each as far as its owner allows.
-- A hidden value comes back as null, the same answer as "not set", so the reply does not
-- reveal that there is something hidden.
create or replace function public.profile_details(user_ids uuid[])
returns table (id uuid, avatar_path text, about text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         case when allowed.ok then p.avatar_path end,
         case when allowed.ok then p.about end
  from public.profiles p
  cross join lateral (select public.may_see_profile_details(p.id) as ok) allowed
  where p.id = any(coalesce(user_ids, '{}'::uuid[]))
  limit 500;
$$;

comment on function public.profile_details(uuid[]) is
  'Profile photo path and about line, nulled where details_visibility does not allow the caller.';

revoke all on function public.profile_details(uuid[]) from public, anon;
grant execute on function public.profile_details(uuid[]) to authenticated;

-- The columns themselves. PostgreSQL cannot take one column away from a table-wide grant, so
-- the table-wide SELECT goes and every other column is granted by name. The list is read from
-- the table as it is now, so columns added by earlier migrations stay readable. A column
-- added to `profiles` later needs its own `grant select (column)`.
do $$
declare
  readable text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into readable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name not in ('avatar_path', 'about');

  revoke select on public.profiles from anon, authenticated;
  revoke select (avatar_path, about) on public.profiles from anon, authenticated;
  execute format('grant select (%s) on public.profiles to anon, authenticated', readable);
end
$$;

-- Search: the photo by the same rule. Everything else as in 20261047.
create or replace function public.search_profiles(term text)
returns table (id uuid, username text, display_name text, avatar text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar,
         case when public.may_see_profile_details(p.id) then p.avatar_path end
  from public.profiles p
  where p.username is not null
    and p.username ilike (term || '%')
    and p.id <> auth.uid()
    and p.profile_visibility <> 'nobody'
  order by p.username
  limit 8;
$$;

grant execute on function public.search_profiles(text) to authenticated;

-- The files. Paths are "{owner id}/{file}"; anything else in the bucket is nobody's photo
-- and is not handed out.
create or replace function public.may_see_avatar_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when split_part(coalesce(object_name, ''), '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.may_see_profile_details(split_part(object_name, '/', 1)::uuid)
    else false
  end;
$$;

revoke all on function public.may_see_avatar_file(text) from public, anon;
grant execute on function public.may_see_avatar_file(text) to authenticated;

drop policy if exists "avatars readable by signed-in users" on storage.objects;
drop policy if exists "avatars readable by allowed viewers" on storage.objects;
create policy "avatars readable by allowed viewers"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and public.may_see_avatar_file(name));
