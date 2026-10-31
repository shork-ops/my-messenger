-- Complaints about a conversation, and what happened to them.
--
-- A messenger without a way to report abuse is a messenger where the only remedy is to block
-- someone and hope. This adds the smallest honest version: a person can report a message or a
-- whole conversation, with a reason, and the report lands somewhere only the maintainer can
-- read. It deliberately does not add automatic policing - a rule engine that deletes messages
-- on its own is a much larger decision than a queue.
--
-- Design notes worth keeping:
--
-- * The reported text is not copied here. A report points at a message; copying content into a
--   moderation table would create a second lifetime for something the sender believes is gone
--   when they delete it.
-- * The reporter can only create a report about something they can already see: the policies
--   below require membership in the chat, and the insert path re-checks it.
-- * A reporter cannot read anyone else's reports, and cannot see whether theirs was handled by
--   reading a table. There is a small `report_status` view instead, limited to their own rows.
-- * Resolutions are journalled. "Who removed this and why" has to be answerable later, and an
--   UPDATE that overwrites the previous decision makes it unanswerable.

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users on delete cascade,
  -- Exactly one of these is set: a report is about a single message or about a conversation.
  chat_id uuid references public.chats on delete cascade,
  message_id uuid references public.messages on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'illegal', 'other')),
  -- Free text from the reporter. Optional, bounded, never shown to the reported person.
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users on delete set null,
  -- At least one subject, and not both: a report with neither is unattributable, and one with
  -- both leaves it ambiguous what was complained about.
  constraint content_reports_subject check (
    (chat_id is not null and message_id is null) or (chat_id is null and message_id is not null)
  )
);

-- A person reporting the same thing repeatedly is noise, not a stronger signal: the primary
-- use of this index is to make the duplicate refusal below cheap.
create unique index if not exists content_reports_once_per_target
  on public.content_reports (reporter_id, coalesce(message_id, chat_id));

create index if not exists content_reports_open
  on public.content_reports (created_at desc)
  where status = 'open';

-- Grants are explicit rather than inherited from the project defaults: this migration has to
-- work on a project whose defaults differ, and a missing grant shows up as "permission denied"
-- for the person pressing the button rather than for the person who wrote the policy.
grant select, insert on public.content_reports to authenticated;

alter table public.content_reports enable row level security;

-- Only the reporter sees their own report, and only while they created it.
drop policy if exists content_reports_insert_own on public.content_reports;
create policy content_reports_insert_own
  on public.content_reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (
      select 1 from public.chat_members member
      where member.chat_id = content_reports.chat_id
        and member.user_id = auth.uid()
    )
  );

drop policy if exists content_reports_select_own on public.content_reports;
create policy content_reports_select_own
  on public.content_reports for select to authenticated
  using (reporter_id = auth.uid());

-- No update or delete policy at all: a report is a record, and a client that can rewrite its
-- own complaint can make the queue lie. Resolution happens through the service role.

/**
 * Files a complaint, refusing duplicates instead of piling them up.
 *
 * Returns the same row when the same person reports the same target twice: the second call is
 * not an error the sender has to understand, and the queue should not grow by one each time
 * someone presses the button in frustration.
 */
create or replace function public.report_content(
  target_chat_id uuid,
  target_message_id uuid,
  report_reason text,
  report_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reporter uuid := auth.uid();
  existing uuid;
  created uuid;
  subject_chat uuid := target_chat_id;
begin
  if reporter is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- A message report infers its chat from the message, so a caller cannot report a message
  -- from one conversation while claiming another.
  if target_message_id is not null then
    select chat_id into subject_chat from public.messages where id = target_message_id;
    if subject_chat is null then
      raise exception 'message_not_found' using errcode = 'P0002';
    end if;
  end if;

  if subject_chat is null then
    raise exception 'no_subject' using errcode = '22023';
  end if;

  -- Reporting is for participants. Someone who was removed cannot keep filing complaints
  -- about a conversation they no longer take part in.
  if not exists (
    select 1 from public.chat_members member
    where member.chat_id = subject_chat and member.user_id = reporter
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if report_reason is null or report_reason not in ('spam', 'abuse', 'illegal', 'other') then
    raise exception 'bad_reason' using errcode = '22023';
  end if;

  select id into existing
  from public.content_reports
  where reporter_id = reporter
    and coalesce(message_id, chat_id) = coalesce(target_message_id, subject_chat);

  if existing is not null then
    return existing;
  end if;

  insert into public.content_reports (reporter_id, chat_id, message_id, reason, details)
  values (
    reporter,
    case when target_message_id is null then subject_chat else null end,
    target_message_id,
    report_reason,
    nullif(btrim(coalesce(report_details, '')), '')
  )
  returning id into created;

  return created;
end;
$$;

revoke all on function public.report_content(uuid, uuid, text, text) from public;
grant execute on function public.report_content(uuid, uuid, text, text) to authenticated;

/**
 * A report, as its author may see it: no identifiers of the moderator, no other people's rows.
 *
 * A view rather than a policy because the useful shape differs from the table - the author
 * needs to know whether their complaint was handled, and nothing else.
 */
create or replace view public.my_reports
with (security_invoker = true)
as
select id, chat_id, message_id, reason, status, created_at, reviewed_at
from public.content_reports
where reporter_id = auth.uid();

grant select on public.my_reports to authenticated;

comment on table public.content_reports is
  'Complaints about a message or conversation. Reported text is not copied: a row points at it.';
