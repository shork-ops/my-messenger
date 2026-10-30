-- Scheduled messages.
--
-- A message can be written now and delivered later. The important decision is where the
-- delay is enforced: if it lived in the sender's browser, closing the tab would silently
-- lose the message, and a messenger that quietly drops a message is worse than one that
-- cannot schedule at all. So the moment is stored on the row and the row is hidden from
-- everyone else until it passes.
--
-- Hidden means "not returned", not "encrypted": the sender still sees their own pending
-- message, because they are the one who chose the moment and may want to cancel it.

alter table public.messages
  add column if not exists send_at timestamptz;

-- Pending messages are the only ones that need the check; indexing every row would cost
-- an index update on every message ever sent.
create index if not exists messages_send_at_idx
  on public.messages (send_at)
  where send_at is not null;

-- Read: a member sees a message once its moment has passed, or if they wrote it.
drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members" on public.messages
for select to authenticated using (
  public.is_chat_member(chat_id)
  and (send_at is null or send_at <= now() or sender_id = (select auth.uid()))
);

-- Write: scheduling is only allowed into the future, and not so far ahead that a typo in a
-- year leaves a message waiting in the database forever.
drop policy if exists "messages_insert_as_member" on public.messages;
create policy "messages_insert_as_member" on public.messages
for insert to authenticated with check (
  sender_id = (select auth.uid())
  and public.is_chat_member(chat_id)
  and (send_at is null or (send_at > now() and send_at < now() + interval '1 year'))
);

-- A pending message can still be cancelled or corrected by its author. Moving it into the
-- past would publish it retroactively under a timestamp nobody agreed to, so the same
-- future-only rule applies.
drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
for update to authenticated using (
  sender_id = (select auth.uid()) and public.is_chat_member(chat_id)
) with check (
  sender_id = (select auth.uid())
  and public.is_chat_member(chat_id)
  and (send_at is null or send_at < now() + interval '1 year')
);

-- The effect column still only allows the original four. The set has grown to ten, and a
-- check that rejects the new ones would fail silently in the client: the update returns an
-- error the UI used to swallow, and the effect simply never sticks.
alter table public.messages drop constraint if exists messages_effect_check;
alter table public.messages add constraint messages_effect_check
  check (
    effect is null
    or effect in ('sparkle','hearts','fireworks','glow','confetti','snow','fire','rainbow','bounce','shadow')
  );
