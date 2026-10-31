/**
 * Device sessions, proven against a real Postgres rather than against the TypeScript that calls it.
 *
 * The point of this file is the negative cases. A session list that lists your own sessions is easy;
 * the feature only becomes safe if a person cannot read or end somebody else's, and that has to be
 * proven where the rule actually lives - in the database, with RLS on and roles simulated - because
 * the client is not the thing enforcing it.
 *
 * Run with `npm run test:device-sessions`. PGlite is a real Postgres compiled to WASM, so policies,
 * `auth.uid()`, `security definer` and grants all behave as they do on the server.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();

// The parts of Supabase the migration depends on. Deliberately minimal: if the migration needed
// more than this, it would be depending on something the test has not thought about.
await db.exec(`
create role authenticated;
create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
-- The migration reads the auth session id from the token, not from a parameter. PostgREST exposes the
-- verified claims as a setting; this mirrors it exactly, including that a client cannot influence it.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),''), '{}')::jsonb
$$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant execute on function auth.jwt() to authenticated, anon;
`);

await db.exec(await readFile(new URL("../supabase/migrations/20261052_device_sessions.sql", import.meta.url), "utf8"));

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [alice, bob] = [uuid(1), uuid(2)];

await db.exec(`insert into auth.users values ('${alice}'), ('${bob}');`);

/**
 * Run a block as a signed-in user, the way a PostgREST request runs.
 *
 * Every block is its own transaction, so a refusal rolls back cleanly and one test cannot leave a
 * row behind for the next. `sessionId` is what goes into the token's `session_id` claim; a row
 * registered without one is a token that could not name its own auth session.
 */
async function as(user, fn, sessionId = null) {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  const claims = sessionId ? JSON.stringify({ sub: user, session_id: sessionId }) : JSON.stringify({ sub: user });
  await db.query("select set_config('request.jwt.claims', $1, true)", [claims]);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

const register = (user, clientId, label, platform = "Windows", sessionId = null) =>
  as(
    user,
    async () => {
      // The fourth argument is still passed as NULL on purpose: the migration must ignore it and use
      // the token. Passing a hostile value here is itself one of the checks below.
      const { rows } = await db.query("select device_register_session($1, $2, $3, null) as id", [
        clientId,
        label,
        platform,
      ]);
      return rows[0].id;
    },
    sessionId
  );

const list = (user, current) =>
  as(user, async () => {
    const { rows } = await db.query("select * from device_list_sessions($1)", [current ?? null]);
    return rows;
  });

const failures = [];
let checks = 0;
const check = async (name, fn) => {
  try {
    await fn();
    checks += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL ${name}: ${error.message}`);
  }
};

console.log("device sessions");

// ---------------------------------------------------------------------------------------------
// Registration and listing
// ---------------------------------------------------------------------------------------------

await check("a session registers and appears only in its own account's list", async () => {
  const id = await register(alice, "alice-laptop-1", "Chrome", "Windows");
  assert.ok(id, "no id returned");

  const mine = await list(alice, "alice-laptop-1");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].client_id, "alice-laptop-1");
  assert.equal(mine[0].device_label, "Chrome");
  assert.equal(mine[0].is_current, true);

  const theirs = await list(bob, "bob-phone-1");
  assert.equal(theirs.length, 0, "bob can see alice's session");
});

await check("registering the same client twice updates one row instead of adding one", async () => {
  await register(alice, "alice-laptop-1", "Chrome", "Windows");
  await register(alice, "alice-laptop-1", "Chrome", "Windows");
  const mine = await list(alice, "alice-laptop-1");
  assert.equal(mine.length, 1, `expected one row, got ${mine.length}`);
});

await check("a second browser is a second session", async () => {
  await register(alice, "alice-phone-9", "Safari", "iOS");
  const mine = await list(alice, "alice-laptop-1");
  assert.equal(mine.length, 2);
  const current = mine.filter((row) => row.is_current);
  assert.equal(current.length, 1);
  assert.equal(current[0].client_id, "alice-laptop-1");
});

// ---------------------------------------------------------------------------------------------
// The negatives: what must not be possible
// ---------------------------------------------------------------------------------------------

await check("bob cannot end alice's session, and there is no client-callable revoke to try", async () => {
  const aliceSession = (await list(alice, "alice-laptop-1")).find((row) => row.client_id === "alice-phone-9");
  assert.ok(aliceSession, "alice's second session is missing");

  // The old RPCs are gone on purpose. A client-callable function that flipped `revoked_at` looked
  // like revocation and revoked nothing, because the auth server never reads our table. Its absence
  // is a check, not an oversight: nothing a client can call may claim to end a session.
  await assert.rejects(
    () => as(bob, () => db.query("select device_revoke_session($1, $2)", [aliceSession.id, "bob-phone-1"])),
    /does not exist/i
  );
  await assert.rejects(
    () => as(bob, () => db.query("select device_revoke_others($1)", ["bob-phone-1"])),
    /does not exist/i
  );

  // And the direct route is closed too: writes go through functions, not through the table.
  await assert.rejects(
    () => as(bob, () => db.query("update device_sessions set revoked_at = now() where id = $1", [aliceSession.id])),
    /permission denied|row-level security/i
  );
  assert.equal((await list(alice, "alice-laptop-1")).length, 2, "alice's session disappeared");
});

await check("bob cannot read alice's rows even with a direct table query", async () => {
  // RLS, not just the RPC: a client that skips the function still sees nothing.
  const { rows } = await as(bob, () => db.query("select * from device_sessions"));
  assert.equal(rows.length, 0, `bob can read ${rows.length} foreign rows`);
});

await check("bob cannot insert a session for alice", async () => {
  await assert.rejects(
    () =>
      as(bob, () =>
        db.query("insert into device_sessions (user_id, client_id) values ($1, 'forged-client')", [alice])
      ),
    /permission denied|row-level security/i
  );
});

await check("an anonymous caller can neither list nor register", async () => {
  await db.exec("begin; set local role anon;");
  try {
    await assert.rejects(() => db.query("select * from device_list_sessions('anon')"));
    await assert.rejects(() => db.query("select device_register_session('anon-client', 'x', 'y', null)"));
  } finally {
    await db.exec("rollback");
  }
});

await check("the prune function is not callable by a client", async () => {
  await assert.rejects(() => as(alice, () => db.query("select device_sessions_prune()")));
});

// ---------------------------------------------------------------------------------------------
// The revocation semantics: what the previous version got wrong
// ---------------------------------------------------------------------------------------------

await check("the auth session id comes from the token, not from the caller's argument", async () => {
  const tokenSession = uuid(700);
  // The hostile client passes a made-up id in the parameter while holding a different one in its
  // token. The token must win.
  const forged = uuid(701);
  await as(
    alice,
    async () => {
      await db.query("select device_register_session($1, 'spoof', 'x', $2)", ["alice-spoof-1", forged]);
    },
    tokenSession
  );

  const { rows } = await as(alice, () =>
    db.query("select auth_session_id from device_sessions where client_id = 'alice-spoof-1'")
  );
  assert.equal(rows[0].auth_session_id, tokenSession, "the client-supplied session id was trusted");
});

await check("a revoked session cannot come back by simply registering again", async () => {
  const sessionId = uuid(710);
  await register(alice, "alice-revoked-1", "Chrome", "Windows", sessionId);

  // Mark it revoked the way the Edge Function does after the auth server has revoked the session.
  await db.query(
    "update device_sessions set revoked_at = now(), revoked_reason = 'user' where user_id = $1 and client_id = 'alice-revoked-1'",
    [alice]
  );

  // The same token asks to register again - which happens on every app start. This is exactly the
  // resurrection bug: it used to succeed and clear the flag.
  await assert.rejects(
    () => register(alice, "alice-revoked-1", "Chrome", "Windows", sessionId),
    /session_revoked/,
    "a revoked session resurrected itself by re-registering"
  );

  const { rows } = await as(alice, () =>
    db.query("select revoked_at from device_sessions where user_id = $1 and client_id = 'alice-revoked-1'", [alice])
  );
  assert.ok(rows[0].revoked_at, "revoked_at was cleared by a re-registration");
});

await check("a genuinely new sign-in does take the row over", async () => {
  const oldSession = uuid(720);
  const newSession = uuid(721);
  await register(alice, "alice-newsignin-1", "Chrome", "Windows", oldSession);
  await db.query(
    "update device_sessions set revoked_at = now(), revoked_reason = 'user' where user_id = $1 and client_id = 'alice-newsignin-1'",
    [alice]
  );

  // A different auth session id means the auth server issued a new session after the revocation.
  await register(alice, "alice-newsignin-1", "Chrome", "Windows", newSession);

  const { rows } = await as(alice, () =>
    db.query(
      "select revoked_at, auth_session_id from device_sessions where user_id = $1 and client_id = 'alice-newsignin-1'",
      [alice]
    )
  );
  assert.equal(rows[0].revoked_at, null, "the new sign-in did not revive the row");
  assert.equal(rows[0].auth_session_id, newSession);
});

await check("a revoked client holding an old token cannot re-register at all", async () => {
  // The same shape as the resurrection check, but here the row was revoked by a *different* session
  // than the one the caller holds: alice revoked this device from her laptop, and the device itself
  // tries to come back with the token it already had.
  const deviceSession = uuid(730);
  await register(alice, "alice-kicked-1", "Chrome", "Android", deviceSession);
  await db.query(
    "update device_sessions set revoked_at = now(), revoked_reason = 'user' where user_id = $1 and client_id = 'alice-kicked-1'",
    [alice]
  );
  await assert.rejects(
    () => register(alice, "alice-kicked-1", "Chrome", "Android", deviceSession),
    /session_revoked/
  );

  // The device does not appear as active anywhere.
  const visible = (await list(alice, "alice-laptop-1")).filter((row) => row.client_id === "alice-kicked-1");
  assert.equal(visible.length, 0, "a revoked device is still listed as active");
});

// ---------------------------------------------------------------------------------------------
// The session-active lookup
// ---------------------------------------------------------------------------------------------

await check("the active check answers only about the caller's own sessions", async () => {
  const sessionId = uuid(500);
  await db.query("update device_sessions set auth_session_id = $1 where user_id = $2 and client_id = 'alice-laptop-1'", [
    sessionId,
    alice,
  ]);

  const mine = await as(alice, async () => {
    const { rows } = await db.query("select device_session_active($1) as active", [sessionId]);
    return rows[0].active;
  });
  assert.equal(mine, true);

  const theirs = await as(bob, async () => {
    const { rows } = await db.query("select device_session_active($1) as active", [sessionId]);
    return rows[0].active;
  });
  // False, not an error: bob learns nothing about whether this id belongs to anyone.
  assert.equal(theirs, false, "bob could confirm the existence of alice's auth session");
});

await check("a row marked ended reports inactive", async () => {
  const sessionId = uuid(501);
  await register(alice, "alice-ended-1", "Edge", "Windows", sessionId);
  await db.query(
    "update device_sessions set revoked_at = now() where user_id = $1 and auth_session_id = $2",
    [alice, sessionId]
  );

  const active = await as(alice, async () => {
    const { rows } = await db.query("select device_session_active($1) as active", [sessionId]);
    return rows[0].active;
  });
  assert.equal(active, false);
});

// ---------------------------------------------------------------------------------------------
// Input bounds
// ---------------------------------------------------------------------------------------------

await check("a too-short client id is refused", async () => {
  await assert.rejects(() => register(alice, "short"), /bad_client_id/);
});

await check("an overlong label is truncated rather than rejected", async () => {
  const long = "x".repeat(300);
  await register(alice, "alice-long-label", long);
  const row = (await list(alice, "alice-laptop-1")).find((item) => item.client_id === "alice-long-label");
  assert.ok(row, "the session was not registered");
  assert.ok(row.device_label.length <= 80, `label is ${row.device_label.length} characters`);
});

await check("the list is capped", async () => {
  for (let index = 0; index < 55; index += 1) {
    await register(alice, `alice-many-${String(index).padStart(3, "0")}`, "Chrome", "Windows");
  }
  const rows = await list(alice, "alice-laptop-1");
  assert.equal(rows.length, 50, `expected the cap of 50, got ${rows.length}`);
});

await check("no refresh token is stored anywhere in the table", async () => {
  const { rows } = await db.query(
    "select column_name from information_schema.columns where table_name = 'device_sessions'"
  );
  const names = rows.map((row) => row.column_name);
  for (const forbidden of ["refresh_token", "token", "access_token", "password"]) {
    assert.ok(!names.includes(forbidden), `device_sessions stores a ${forbidden} column`);
  }
});

await db.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} device-session check(s) failed`);
  process.exit(1);
}
console.log(
  `\nPASS: ${checks} checks - sessions register per client, a foreign session can be neither read nor revoked ` +
    "(RLS refuses the direct route and no client-callable revoke exists), the auth session id comes from the " +
    "verified token rather than the caller's argument, a revoked session cannot come back by re-registering " +
    "while a genuinely new sign-in takes the row over, the active check answers only about the caller, and " +
    "no token is stored."
);
