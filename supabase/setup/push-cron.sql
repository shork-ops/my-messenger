-- Run after 20261059_push_queue.sql and after deploying push-dispatch.
-- First add two Vault secrets in Dashboard (do not put their values in this file):
-- nexus_project_url = https://PROJECT_REF.supabase.co
-- nexus_push_webhook_secret = same value as Edge Functions PUSH_WEBHOOK_SECRET
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='nexus_project_url')
    or not exists(select 1 from vault.decrypted_secrets where name='nexus_push_webhook_secret') then
    raise exception 'Create nexus_project_url and nexus_push_webhook_secret in Vault first';
  end if;
end;
$$;

-- A stable name makes running this script again update the existing job.
select cron.schedule('nexus-push-dispatch', '* * * * *', $job$
  select net.http_post(
    url := (select rtrim(decrypted_secret,'/') from vault.decrypted_secrets where name='nexus_project_url') || '/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='nexus_push_webhook_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
