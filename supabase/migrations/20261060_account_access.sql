-- Server boundary for MFA and revoked sessions. PostgREST protects RPCs;
-- restrictive policies protect Storage and Realtime paths too.
begin;
create or replace function public.account_access_allowed() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt(); session_key uuid;
begin
  if actor is null then return false; end if;
  begin session_key:=nullif(claims->>'session_id','')::uuid;
  exception when invalid_text_representation then return false; end;
  if session_key is null or not exists (
    select 1 from auth.sessions s where s.id=session_key and s.user_id=actor
    and (s.not_after is null or s.not_after>now())
  ) then return false; end if;
  return coalesce(claims->>'aal','')='aal2' or not exists (
    select 1 from auth.mfa_factors f where f.user_id=actor and f.status='verified'
  );
end; $$;
revoke all on function public.account_access_allowed() from public,anon;
grant execute on function public.account_access_allowed() to authenticated,service_role;

create or replace function public.assert_account_access() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  -- Maintenance webhooks retain service-role authorization. An anonymous request
  -- still has to satisfy the existing table/function grants and policies.
  if auth.role()='authenticated' and not public.account_access_allowed() then
    raise exception 'Account session expired, revoked, or requires MFA' using errcode='42501';
  end if;
end; $$;
revoke all on function public.assert_account_access() from public;
grant execute on function public.assert_account_access() to anon,authenticated,service_role;

do $$ declare item record; existing_hook text; begin
  for item in select schemaname,tablename from pg_tables
    where schemaname='public' or (schemaname='storage' and tablename='objects')
  loop
    execute format('drop policy if exists nexus_account_access on %I.%I',item.schemaname,item.tablename);
    execute format('create policy nexus_account_access on %I.%I as restrictive for all to authenticated using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()))',item.schemaname,item.tablename);
  end loop;
  -- Fail visibly instead of replacing another application's existing pre-request hook.
  if exists(select 1 from pg_roles where rolname='authenticator') then
    select split_part(setting,'=',2) into existing_hook
    from pg_db_role_setting config cross join lateral unnest(config.setconfig) setting
    where config.setrole in (0,(select oid from pg_roles where rolname='authenticator'))
      and config.setdatabase in (0,(select oid from pg_database where datname=current_database()))
      and setting like 'pgrst.db_pre_request=%'
      and split_part(setting,'=',2) not in ('','public.assert_account_access')
    limit 1;
    if existing_hook is not null and existing_hook not in ('','public.assert_account_access') then
      raise exception 'Existing PostgREST hook % must call public.assert_account_access before applying this migration',existing_hook;
    end if;
    alter role authenticator set pgrst.db_pre_request='public.assert_account_access';
    -- A database-specific empty setting must not shadow the role-wide guard.
    execute format('alter role authenticator in database %I set pgrst.db_pre_request=%L',current_database(),'public.assert_account_access');
  else
    raise exception 'authenticator role is required to protect SECURITY DEFINER RPCs';
  end if;
end; $$;
notify pgrst,'reload config';
commit;
