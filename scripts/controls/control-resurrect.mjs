// Negative control: prove the resurrection check is not vacuous.
//
// It takes the OLD registration body (the one that cleared `revoked_at` on any re-registration) and
// runs the same assertion against it. If the test still passes, the test is broken, not the fix.

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const db = new PGlite();
await db.exec(`
create role authenticated;
create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),''), '{}')::jsonb
$$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant execute on function auth.jwt() to authenticated, anon;
`);

await db.exec(await readFile(new URL("../../supabase/migrations/20261052_device_sessions.sql", import.meta.url), "utf8"));

// Reinstate the bug under a different name, so the old behaviour can be exercised directly.
await db.exec(`
create or replace function public.old_register(p_client_id text, p_label text) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); row_id uuid;
begin
  insert into public.device_sessions (user_id, client_id, device_label)
  values (me, p_client_id, p_label)
  on conflict (user_id, client_id) do update
    set last_seen_at = now(), revoked_at = null, revoked_reason = null
  returning id into row_id;
  return row_id;
end;
$fn$;
grant execute on function public.old_register(text, text) to authenticated;
`);

const alice = "00000000-0000-0000-0000-000000000001";
await db.exec(`insert into auth.users values ('${alice}');`);

async function as(fn) {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [alice]);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

// Register, revoke, then "re-register" through the buggy function.
await as(() => db.query("select device_register_session('client-abc-1', 'Chrome', 'Windows', null)"));
await db.query(
  "update device_sessions set revoked_at = now(), revoked_reason = 'user' where client_id = 'client-abc-1'"
);

// The fixed function must refuse.
let refused = false;
try {
  await as(() => db.query("select device_register_session('client-abc-1', 'Chrome', 'Windows', null)"));
} catch (error) {
  refused = /session_revoked/.test(error.message);
}
assert.equal(refused, true, "the fixed function did NOT refuse a revoked re-registration");

// The buggy one must succeed and clear the flag - proving the test above detects the old defect.
await as(() => db.query("select old_register('client-abc-1', 'Chrome')"));
const { rows } = await db.query("select revoked_at from device_sessions where client_id = 'client-abc-1'");
assert.equal(rows[0].revoked_at, null, "the buggy control did not reproduce the resurrection");

console.log("PASS: the resurrection check discriminates - the fixed function refuses, the old one revives");
await db.close();
