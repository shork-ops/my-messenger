/**
 * The device list: what the client makes of the server's rows, and what the two functions in
 * 20261054 let a signed-in person do - see and end their own sessions, never anyone else's,
 * and never the one they are using. The database part runs on a small stand-in for
 * auth.sessions, the same way scripts/check-view-once.mjs does.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { isMissingFunction, sessionTitle, sortSessions, toAccountSession } from "./accountSessions";

describe("reading the server's session rows", () => {
  const row = {
    id: "s1",
    created_at: "2026-10-01T10:00:00Z",
    last_active: "2026-10-30T10:00:00Z",
    user_agent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36",
    ip: "10.0.0.1",
    is_current: false,
  };

  it("names the browser and the system", () => {
    const session = toAccountSession(row);
    expect(sessionTitle(session)).toBe("Chrome · Android");
    expect(session.lastActive).toBe(Date.parse("2026-10-30T10:00:00Z"));
    expect(session.ip).toBe("10.0.0.1");
  });

  it("says plainly when the device is unknown", () => {
    const session = toAccountSession({ ...row, user_agent: null, ip: null, last_active: null });
    expect(sessionTitle(session)).toBe("Неизвестное устройство");
    expect(session.lastActive).toBe(Date.parse(row.created_at));
    expect(session.ip).toBeNull();
  });

  it("puts this device first, then the most recent", () => {
    const sorted = sortSessions([
      toAccountSession({ ...row, id: "old", last_active: "2026-10-01T00:00:00Z" }),
      toAccountSession({ ...row, id: "new", last_active: "2026-10-31T00:00:00Z" }),
      toAccountSession({ ...row, id: "here", last_active: "2026-09-01T00:00:00Z", is_current: true }),
    ]);
    expect(sorted.map((session) => session.id)).toEqual(["here", "new", "old"]);
  });

  it("recognises a project that has not run the migration", () => {
    expect(isMissingFunction({ code: "PGRST202", message: "Could not find the function public.my_sessions" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "42501" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [alice, bob] = [uuid(1), uuid(2)];
const [aliceHere, alicePhone, aliceExpired, bobLaptop] = [uuid(11), uuid(12), uuid(13), uuid(21)];

describe("migration 20261054 on a stand-in for auth.sessions", () => {
  let db: PGlite;
  const migration = readFileSync(new URL("../../supabase/migrations/20261054_account_sessions.sql", import.meta.url), "utf8");

  async function as<T>(role: "authenticated" | "anon", user: string | null, sessionId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await db.exec(`begin; set local role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [
      user ?? "",
      JSON.stringify(user ? { sub: user, session_id: sessionId } : {}),
    ]);
    try {
      const { rows } = await db.query<T>(sql, params);
      await db.exec("commit");
      return rows;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create table auth.users(id uuid primary key);
      -- The columns the migration reads, with the types Supabase uses.
      create table auth.sessions(
        id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
        created_at timestamptz, updated_at timestamptz, not_after timestamptz,
        refreshed_at timestamp, user_agent text, ip inet
      );
      create table auth.refresh_tokens(id bigserial primary key, session_id uuid references auth.sessions(id) on delete cascade);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth, public to authenticated, anon;
      grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
      insert into auth.users values ('${alice}'), ('${bob}');
      insert into auth.sessions values
        ('${aliceHere}', '${alice}', now() - interval '3 days', now() - interval '3 days', null, (now() at time zone 'utc') - interval '1 minute', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', '10.0.0.1'),
        ('${alicePhone}', '${alice}', now() - interval '9 days', now() - interval '2 days', null, null, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1', '10.0.0.2'),
        ('${aliceExpired}', '${alice}', now() - interval '40 days', now() - interval '40 days', now() - interval '1 day', null, 'Firefox', null),
        ('${bobLaptop}', '${bob}', now() - interval '1 day', now() - interval '1 day', null, null, 'Safari', null);
      insert into auth.refresh_tokens(session_id) values ('${alicePhone}'), ('${aliceHere}');
    `);
    await db.exec(migration);
    // Running it again must not fail.
    await db.exec(migration);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  type Row = { id: string; is_current: boolean; ip: string | null; last_active: Date };

  it("lists only the caller's live sessions, this one first", async () => {
    const rows = await as<Row>("authenticated", alice, aliceHere, "select * from public.my_sessions()");
    expect(rows.map((row) => row.id)).toEqual([aliceHere, alicePhone]);
    expect(rows.map((row) => row.is_current)).toEqual([true, false]);
    expect(rows[0].ip).toBe("10.0.0.1");
    // refreshed_at (UTC, no time zone) is the freshest of the three times for this one.
    expect(Date.now() - new Date(rows[0].last_active).getTime()).toBeLessThan(5 * 60_000);
  });

  it("does not end the session the request came from", async () => {
    const [{ end_session }] = await as<{ end_session: boolean }>("authenticated", alice, aliceHere, "select public.end_session($1)", [aliceHere]);
    expect(end_session).toBe(false);
    expect((await db.query("select 1 from auth.sessions where id = $1", [aliceHere])).rows).toHaveLength(1);
  });

  it("does not end someone else's session", async () => {
    const [{ end_session }] = await as<{ end_session: boolean }>("authenticated", alice, aliceHere, "select public.end_session($1)", [bobLaptop]);
    expect(end_session).toBe(false);
    expect((await db.query("select 1 from auth.sessions where id = $1", [bobLaptop])).rows).toHaveLength(1);
  });

  it("ends another of the caller's sessions, refresh tokens included", async () => {
    const [{ end_session }] = await as<{ end_session: boolean }>("authenticated", alice, aliceHere, "select public.end_session($1)", [alicePhone]);
    expect(end_session).toBe(true);
    expect((await db.query("select 1 from auth.sessions where id = $1", [alicePhone])).rows).toHaveLength(0);
    expect((await db.query("select 1 from auth.refresh_tokens where session_id = $1", [alicePhone])).rows).toHaveLength(0);
    const rows = await as<Row>("authenticated", alice, aliceHere, "select * from public.my_sessions()");
    expect(rows.map((row) => row.id)).toEqual([aliceHere]);
  });

  it("is closed to visitors who are not signed in, and auth.sessions stays closed to everyone", async () => {
    await expect(as("anon", null, null, "select * from public.my_sessions()")).rejects.toThrow(/permission denied/);
    await expect(as("anon", null, null, "select public.end_session($1)", [bobLaptop])).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", alice, aliceHere, "select * from auth.sessions")).rejects.toThrow(/permission denied/);
  });
});
