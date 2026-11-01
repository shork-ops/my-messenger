-- 20261055: «Огонёк дружбы» - days in a row both people in a direct chat wrote to each other.
--
-- Why a table of its own instead of counting messages: messages do not stay. Disappearing
-- messages are deleted by the clean-up job, "delete for everyone" removes them, and a whole
-- history can be cleared. A streak that went out because a timer purged last week would be a
-- streak that lies. So every message leaves a note that this person wrote in this chat during
-- this quarter of an hour - nothing about what was written - and the notes are what is counted.
--
-- Quarter hours, not days, because "a day" is the reader's day: 23:30 in Novosibirsk is
-- 16:30 in Moscow. A quarter-hour slot falls on one side of midnight in every time zone in use,
-- including the half- and quarter-hour ones, so the same notes give the right days anywhere.
--
-- Only direct chats are counted: a streak is between two people, and in a group "both wrote"
-- means nothing. Scheduled messages count when they are sent, not when they are written; one
-- still waiting is not counted yet, because it may never go.
--
-- The table has row level security and no policies: nobody reads it directly. The only way
-- in is my_streaks(), which answers for the caller's own direct chats.
--
-- Safe to run more than once.

create table if not exists public.chat_activity (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot timestamptz not null,
  primary key (chat_id, user_id, slot)
);

alter table public.chat_activity enable row level security;
revoke all on public.chat_activity from anon, authenticated;

create or replace function public.activity_slot(moment timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select date_bin('15 minutes', moment, timestamptz '2000-01-01 00:00:00+00')
$$;

create or replace function public.record_chat_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.send_at is not null and new.send_at > now() then
    return new;
  end if;
  if exists (select 1 from public.chats c where c.id = new.chat_id and not c.is_group and not c.is_channel) then
    insert into public.chat_activity (chat_id, user_id, slot)
    values (new.chat_id, new.sender_id, public.activity_slot(coalesce(new.send_at, new.created_at)))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_record_activity on public.messages;
create trigger messages_record_activity
after insert on public.messages
for each row execute function public.record_chat_activity();

-- A scheduled message counts on the day it goes. The scheduler does not touch the row when
-- the moment passes - the row simply becomes visible - so the note is written on the first
-- call to my_streaks() after it, below.

-- What was written before this migration, for the last 400 days.
insert into public.chat_activity (chat_id, user_id, slot)
select m.chat_id, m.sender_id, public.activity_slot(coalesce(m.send_at, m.created_at))
from public.messages m
join public.chats c on c.id = m.chat_id
where not c.is_group
  and not c.is_channel
  and coalesce(m.send_at, m.created_at) <= now()
  and coalesce(m.send_at, m.created_at) > now() - interval '400 days'
on conflict do nothing;

-- The caller's streaks, one row per direct chat that ever had a day where both wrote.
--
-- last_full    the latest day both wrote, in the caller's time zone
-- run_days     how many days in a row ended on last_full
-- record_days  the longest run this chat ever had (within the last 400 days)
-- today        today's date in that time zone, so the app does not trust the device clock
-- today_mine / today_theirs   who has already written today
--
-- An unknown time zone falls back to UTC instead of failing: a wrong midnight is better than
-- no answer at all.
create or replace function public.my_streaks(p_tz text default 'UTC')
returns table (
  chat_id uuid,
  last_full date,
  run_days integer,
  record_days integer,
  today date,
  today_mine boolean,
  today_theirs boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  zone text := 'UTC';
  local_today date;
begin
  if me is null then
    return;
  end if;
  begin
    perform now() at time zone p_tz;
    zone := coalesce(nullif(p_tz, ''), 'UTC');
  exception when others then
    zone := 'UTC';
  end;
  local_today := (now() at time zone zone)::date;

  -- Scheduled messages whose moment has passed since they were written.
  insert into public.chat_activity (chat_id, user_id, slot)
  select m.chat_id, m.sender_id, public.activity_slot(m.send_at)
  from public.messages m
  join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = me
  join public.chats c on c.id = m.chat_id and not c.is_group and not c.is_channel
  where m.send_at is not null
    and m.send_at <= now()
    and m.send_at > now() - interval '2 days'
  on conflict do nothing;

  return query
  with direct as (
    select cm.chat_id
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id
    where cm.user_id = me and not c.is_group and not c.is_channel
  ),
  days as (
    select a.chat_id,
           (a.slot at time zone zone)::date as day,
           bool_or(a.user_id = me) as by_me,
           bool_or(a.user_id <> me) as by_them
    from public.chat_activity a
    join direct d on d.chat_id = a.chat_id
    where a.slot > now() - interval '400 days'
    group by a.chat_id, (a.slot at time zone zone)::date
  ),
  islands as (
    select chat_id, day, day - (row_number() over (partition by chat_id order by day))::integer as island
    from days
    where by_me and by_them
  ),
  runs as (
    select chat_id, max(day) as last_day, count(*)::integer as length
    from islands
    group by chat_id, island
  ),
  latest as (
    select distinct on (chat_id) chat_id, last_day, length
    from runs
    order by chat_id, last_day desc
  ),
  best as (
    select chat_id, max(length) as record from runs group by chat_id
  )
  select l.chat_id,
         l.last_day,
         l.length,
         b.record::integer,
         local_today,
         coalesce(t.by_me, false),
         coalesce(t.by_them, false)
  from latest l
  join best b on b.chat_id = l.chat_id
  left join days t on t.chat_id = l.chat_id and t.day = local_today;
end;
$$;

revoke all on function public.my_streaks(text) from public, anon;
grant execute on function public.my_streaks(text) to authenticated;
revoke all on function public.record_chat_activity() from public, anon, authenticated;
