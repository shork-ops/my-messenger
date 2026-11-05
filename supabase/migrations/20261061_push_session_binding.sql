-- Revoking an auth session also revokes that device's push endpoint.
begin;
alter table public.push_subscriptions add column if not exists session_id uuid references auth.sessions(id) on delete cascade;
create index if not exists push_subscriptions_session_idx on public.push_subscriptions(session_id);
create or replace function public.bind_push_session() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.role()='authenticated' then
    perform public.assert_account_access();
    new.session_id:=(auth.jwt()->>'session_id')::uuid;
  end if;
  return new;
end; $$;
revoke all on function public.bind_push_session() from public,anon,authenticated;
drop trigger if exists push_subscription_session on public.push_subscriptions;
create trigger push_subscription_session before insert or update on public.push_subscriptions
for each row execute function public.bind_push_session();

-- Legacy subscriptions stay dormant until the browser refreshes its registration.
-- This avoids guessing which active session owns a pre-migration endpoint.
create or replace function public.active_push_subscriptions(p_users uuid[])
returns table(id uuid,endpoint text,p256dh text,auth text)
language sql stable security definer set search_path='' as $$
  select p.id,p.endpoint,p.p256dh,p.auth
  from public.push_subscriptions p join auth.sessions s on s.id=p.session_id and s.user_id=p.user_id
  where p.user_id=any(p_users) and (s.not_after is null or s.not_after>now())
$$;
revoke all on function public.active_push_subscriptions(uuid[]) from public,anon,authenticated;
grant execute on function public.active_push_subscriptions(uuid[]) to service_role;
commit;
