begin;
alter table public.messages add column if not exists timeline_at timestamptz
  generated always as (coalesce(send_at,created_at)) stored;
create index if not exists messages_chat_timeline_idx on public.messages(chat_id,timeline_at desc,id desc);

create or replace function public.message_history_page(
  p_chat uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50
) returns setof public.messages
language sql stable security invoker set search_path='' as $$
  select m.* from public.messages m
  where m.chat_id=p_chat and (m.send_at is null or m.send_at<=now())
    and (p_before_at is null or (m.timeline_at,m.id)<(p_before_at,p_before_id))
    and not exists(select 1 from public.message_hides h where h.message_id=m.id and h.user_id=auth.uid())
  order by m.timeline_at desc,m.id desc
  limit greatest(1,least(coalesce(p_limit,50),100))
$$;
revoke all on function public.message_history_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.message_history_page(uuid,timestamptz,uuid,integer) to authenticated;

-- A known row may be the sender's pending message. Classify it using server time.
create or replace function public.message_history_known(p_chat uuid,p_ids uuid[])
returns setof jsonb language sql stable security invoker set search_path='' as $$
  select to_jsonb(m)||jsonb_build_object('history_pending',coalesce(m.send_at>now(),false))
  from public.messages m where m.chat_id=p_chat and m.id=any(p_ids)
    and cardinality(p_ids)<=100
    and not exists(select 1 from public.message_hides h where h.message_id=m.id and h.user_id=auth.uid())
$$;
revoke all on function public.message_history_known(uuid,uuid[]) from public,anon;
grant execute on function public.message_history_known(uuid,uuid[]) to authenticated;
commit;
