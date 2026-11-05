-- Run after push migrations and deployment of push-notify with --no-verify-jwt.
-- Vault must contain nexus_project_url and nexus_push_webhook_secret.
begin;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if (select count(*) from vault.secrets where name='nexus_project_url')<>1
    or (select count(*) from vault.secrets where name='nexus_push_webhook_secret')<>1 then
    raise exception 'Exactly one project URL and webhook secret are required in Vault';
  end if;
end;
$$;
create or replace function public.notify_push_on_message() returns trigger
language plpgsql security definer set search_path='' as $$
declare project_url text; webhook_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='nexus_project_url';
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name='nexus_push_webhook_secret';
  if project_url is null or webhook_secret is null then
    raise log 'Nexus push webhook configuration unavailable; message retained in push queue';
    return new;
  end if;
  perform net.http_post(
    url:=rtrim(project_url,'/')||'/functions/v1/push-notify',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||webhook_secret),
    body:=jsonb_build_object('type','INSERT','table','messages','record',jsonb_build_object('id',new.id)),
    timeout_milliseconds:=120000
  );
  return new;
exception when others then
  raise log 'Nexus push webhook enqueue failed (%); durable queue will retry',sqlstate;
  return new;
end;
$$;
revoke all on function public.notify_push_on_message() from public,anon,authenticated;

-- Replace only the previous Nexus push hook; preserve unrelated message triggers.
do $$ declare item record; begin
  for item in
    select t.tgname from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
    where t.tgrelid='public.messages'::regclass and not t.tgisinternal
      and (t.tgname='on_message_insert_push' or t.tgfoid='public.notify_push_on_message()'::regprocedure
        or (n.nspname='supabase_functions' and p.proname='http_request' and pg_get_triggerdef(t.oid) like '%/functions/v1/push-notify%'))
  loop execute format('drop trigger %I on public.messages',item.tgname);end loop;
end; $$;
create trigger on_message_insert_push after insert on public.messages
for each row execute function public.notify_push_on_message();
commit;
