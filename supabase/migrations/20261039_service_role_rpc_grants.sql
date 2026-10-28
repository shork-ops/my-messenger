-- Lets the service role call the user-facing RPCs.
--
-- Found by a live check: `service_role` got "permission denied for function
-- start_direct_chat". The RPCs were granted only to `authenticated`, which is
-- right for the browser, but the service role is also used by Edge Functions
-- (account deletion) and by support tooling, and those calls failed.
--
-- `security definer` functions still enforce their own ownership checks through
-- `auth.uid()`, so granting execute to service_role does not widen what an
-- ordinary user can do: service_role is already trusted with every table.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end;
$$;
