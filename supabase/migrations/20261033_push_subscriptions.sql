-- Phase 1: Web Push subscriptions for background notifications.
-- Run in Supabase SQL Editor after 20261032_presence.sql.
--
-- Flow: browser registers the service worker, gets a PushSubscription from the Push API,
-- and stores it here. The Edge Function `push-notify` reads `VAPID_PRIVATE_KEY` from the
-- function secrets and sends an encrypted notification for each INSERT into `messages`.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_self" on public.push_subscriptions;
create policy "push_subscriptions_select_self" on public.push_subscriptions
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_insert_self" on public.push_subscriptions;
create policy "push_subscriptions_insert_self" on public.push_subscriptions
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_update_self" on public.push_subscriptions;
create policy "push_subscriptions_update_self" on public.push_subscriptions
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_delete_self" on public.push_subscriptions;
create policy "push_subscriptions_delete_self" on public.push_subscriptions
for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;
-- The Edge Function uses the service role key, which bypasses RLS by design.
revoke all on public.push_subscriptions from anon;
