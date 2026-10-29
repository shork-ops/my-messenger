-- A short self-description, shown on the profile card.
--
-- 140 characters is the limit most messengers settle on: long enough for a line or
-- two, short enough to fit a card without truncating into uselessness. The check
-- lives in the database too, because a client-side limit is a suggestion.

alter table public.profiles
  add column if not exists about text;

alter table public.profiles
  drop constraint if exists profiles_about_length;

alter table public.profiles
  add constraint profiles_about_length check (about is null or char_length(about) <= 140);

comment on column public.profiles.about is
  'Short self-description, at most 140 characters. Null when the user has not set one.';
