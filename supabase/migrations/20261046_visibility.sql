-- Who may find this profile, and who may start a chat with it.
--
-- The columns are plain text with a check constraint rather than an enum: an enum
-- would need a migration to add a level, and these are presentation-level choices.
--
-- Storing the setting is only half of it. The rule has to be enforced where the
-- search and the chat creation actually happen, otherwise a modified client sends
-- whatever it likes and the setting is a decoration (see the function changes
-- below).

alter table public.profiles
  add column if not exists profile_visibility text not null default 'everyone',
  add column if not exists message_policy text not null default 'everyone';

alter table public.profiles
  drop constraint if exists profiles_profile_visibility_check,
  add constraint profiles_profile_visibility_check
    check (profile_visibility in ('everyone', 'known', 'nobody'));

alter table public.profiles
  drop constraint if exists profiles_message_policy_check,
  add constraint profiles_message_policy_check
    check (message_policy in ('everyone', 'known'));

comment on column public.profiles.profile_visibility is
  'Who may find this profile in search: everyone, only people sharing a chat, or nobody.';
comment on column public.profiles.message_policy is
  'Who may open a direct chat: everyone, or only people already known.';

-- Whether a stranger may write to this account.
create or replace function public.may_message(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.message_policy = 'everyone' and p.profile_visibility <> 'nobody'
      from public.profiles p
      where p.id = target
    ),
    true
  );
$$;

comment on function public.may_message is
  'False when the target hides from search or only accepts messages from people they already know.';

grant execute on function public.may_message(uuid) to authenticated;

-- Whether this account may appear in someone else''s search results.
create or replace function public.is_searchable(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.profile_visibility <> 'nobody' from public.profiles p where p.id = target),
    true
  );
$$;

comment on function public.is_searchable is
  'False when the profile is hidden from search entirely.';

grant execute on function public.is_searchable(uuid) to authenticated;
