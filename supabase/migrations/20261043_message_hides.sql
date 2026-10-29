-- Messages hidden for one account only.
--
-- "Delete for me" cannot be a column on the message: the same row is visible to
-- everyone else. A join table keeps the message intact and records who chose not
-- to see it.

create table if not exists public.message_hides (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_hides_user_idx on public.message_hides (user_id);

alter table public.message_hides enable row level security;

-- An account manages only its own hidden rows. Reading someone else's list would
-- reveal which messages they were sent, which is not ours to disclose.
drop policy if exists "message_hides select own" on public.message_hides;
create policy "message_hides select own" on public.message_hides
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "message_hides insert own" on public.message_hides;
create policy "message_hides insert own" on public.message_hides
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "message_hides delete own" on public.message_hides;
create policy "message_hides delete own" on public.message_hides
  for delete to authenticated using (user_id = auth.uid());

comment on table public.message_hides is
  'Messages an account removed from its own view. The message itself is untouched.';
