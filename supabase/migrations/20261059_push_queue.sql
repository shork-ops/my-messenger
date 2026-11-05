begin;
create table if not exists public.push_jobs (
  message_id uuid primary key references public.messages(id) on delete cascade,
  available_at timestamptz not null,
  lease_until timestamptz,
  lease_token uuid,
  completed_at timestamptz,
  attempts integer not null default 0
);
create index if not exists push_jobs_due_idx on public.push_jobs(available_at) where completed_at is null;
create table if not exists public.push_delivery_receipts (
  message_id uuid not null references public.push_jobs(message_id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key(message_id,subscription_id)
);
alter table public.push_jobs enable row level security;
alter table public.push_delivery_receipts enable row level security;
revoke all on public.push_jobs, public.push_delivery_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.push_jobs, public.push_delivery_receipts to service_role;

create or replace function public.enqueue_message_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.push_jobs(message_id,available_at) values(new.id,coalesce(new.send_at,now())) on conflict do nothing;
  elsif new.send_at is distinct from old.send_at then
    update public.push_jobs set available_at=coalesce(new.send_at,now())
    where message_id=new.id and completed_at is null;
  end if;
  return new;
end; $$;
revoke all on function public.enqueue_message_push() from public,anon,authenticated;
drop trigger if exists messages_enqueue_push on public.messages;
create trigger messages_enqueue_push after insert or update of send_at on public.messages
for each row execute function public.enqueue_message_push();
-- Backfill only pending scheduled messages, never replay historic conversations.
insert into public.push_jobs(message_id,available_at)
select id,send_at from public.messages where send_at>now() and deleted_at is null
on conflict do nothing;

create or replace function public.claim_message_push(p_message uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid(); claimed uuid;
begin
  update public.push_jobs j set lease_until=now()+interval '5 minutes', lease_token=token, attempts=attempts+1
  where j.message_id=p_message and j.completed_at is null and j.available_at<=now()
    and (j.lease_until is null or j.lease_until<=now())
    and exists(select 1 from public.messages m where m.id=p_message and (m.send_at is null or m.send_at<=now()))
  returning j.lease_token into claimed;
  return claimed;
end; $$;
create or replace function public.finish_message_push(p_message uuid,p_token uuid,p_success boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.push_jobs set completed_at=case when p_success then now() else null end,
    lease_until=null,lease_token=null,
    available_at=case when p_success then available_at else greatest(now()+make_interval(secs=>least(3600,60*power(2,least(attempts-1,6))::integer)), (select m.send_at from public.messages m where m.id=p_message)) end
  where message_id=p_message and lease_token=p_token and lease_until>now();
  return found;
end; $$;
revoke all on function public.claim_message_push(uuid),public.finish_message_push(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_message_push(uuid),public.finish_message_push(uuid,uuid,boolean) to service_role;
commit;
