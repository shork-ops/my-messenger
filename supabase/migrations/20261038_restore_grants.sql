-- Restores the grants Supabase expects on public tables.
--
-- Found while running a live two-account check: `service_role` could not read a
-- single table ("permission denied for table chats"). The tables were created
-- without the grants Supabase normally applies, and RLS being off does not help
-- because the role still needs table privileges.
--
-- Two things were broken by this:
--   * the `cleanup-media` and `delete-account` Edge Functions, which run with
--     the service role key and therefore could never touch app data;
--   * any future admin tooling, plus Supabase Studio queries made as
--     service_role.
--
-- `authenticated` already had SELECT, which is why the app itself worked; the
-- missing INSERT/UPDATE/DELETE for it are re-granted here too, since RLS is what
-- constrains those roles, not the absence of grants.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to authenticated, service_role;

-- Apply the same defaults to anything created later, so this cannot regress.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant usage, select on sequences to authenticated;
