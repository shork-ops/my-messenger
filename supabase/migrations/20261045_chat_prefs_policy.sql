-- Members may change their own chat settings.
--
-- chat_members had no UPDATE policy for a plain member: only an owner could write
-- to the table, so muting or archiving silently affected nothing. The obvious fix
-- - a policy allowing members to update their own row - would also let them change
-- their `role` to admin, because a row policy cannot restrict which columns an
-- UPDATE touches.
--
-- So the write goes through a function that sets only the two preference columns.
-- Column-level GRANTs then narrow what a direct UPDATE from the client can reach.

revoke update on public.chat_members from authenticated;
grant update (muted_until, archived_at, last_read_at) on public.chat_members to authenticated;

drop policy if exists "chat_members_update_own_settings" on public.chat_members;
create policy "chat_members_update_own_settings" on public.chat_members
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Update this account's own chat preferences.
--
-- The parameters carry a p_ prefix on purpose: a plpgsql variable that shares a
-- column's name is resolved differently inside expressions than outside them, and
-- that ambiguity is how a function like this writes NULL over the value it was
-- handed.
create or replace function public.set_chat_preferences(
  p_chat uuid,
  p_muted_until timestamptz default null,
  p_archived boolean default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.chat_members
  set muted_until = p_muted_until,
      archived_at = case
        when p_archived is true then now()
        when p_archived is false then null
        else archived_at
      end
  where chat_id = p_chat
    and user_id = auth.uid();
end;
$$;

comment on function public.set_chat_preferences is
  'Sets the calling account''s mute and archive state for one chat. Cannot touch role or membership.';

grant execute on function public.set_chat_preferences(uuid, timestamptz, boolean) to authenticated;
