-- Nexus Messenger: unique usernames for user discovery.
-- Run once in Supabase Dashboard -> SQL Editor after the existing schema.
alter table public.profiles
  add column if not exists username text;

-- Existing profiles may leave username empty until their owners choose one.
alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (
    username is null
    or (
      char_length(username) between 3 and 20
      and username ~ '^[a-z0-9_]+$'
    )
  );

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username))
  where username is not null;

grant select on public.profiles to authenticated;
