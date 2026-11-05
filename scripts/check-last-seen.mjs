/**
 * «был(а) в сети», checked against a real PostgreSQL.
 *
 * The switch «Скрывать „был(а) в сети“» is only worth something if the database keeps to it, so
 * the database is what is tested: that the time can no longer be read from the table directly by
 * anybody, that `last_seen_of` gives it to people who share a personal chat with the owner and to
 * nobody else - not to a stranger, not to someone who only shares a group - that the switch hides
 * it from everyone but the owner, that a block hides it in both directions, that `visible_last_seen`
 * follows the same rule, that the app can still stamp the time and read everything else it reads,
 * and that running this migration or the one before it again changes nothing.
 *
 * The whole chain is installed as a new project would be - supabase/schema.sql, then every
 * migration in order.
 */


import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = new URL("../supabase/", import.meta.url);
const files = [
  "schema.sql",
  ...(await readdir(new URL("migrations/", root))).filter((f) => f.endsWith(".sql")).sort().map((f) => `migrations/${f}`),
];

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
create role authenticator; create role authenticated; create role anon; create role service_role;
create schema auth; create schema storage; create schema extensions;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now(), updated_at timestamptz default now(), not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet);
create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),status text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'')::text $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema auth, public, storage to authenticated, anon, service_role;
grant execute on all functions in schema auth to authenticated, anon, service_role;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/'); $$;
create publication supabase_realtime;
`);

const migration = await readFile(new URL("migrations/20261058_last_seen_privacy.sql", root), "utf8");
const photoMigration = await readFile(new URL("migrations/20261057_profile_details_privacy.sql", root), "utf8");
for (const file of files) await db.exec(await readFile(new URL(file, root), "utf8"));

const results = [];
try {
function ok(label) {
  results.push(label);
  console.log(`  ok  ${label}`);
}

async function as(user, fn, role = "authenticated") {
  if (user) await db.query("insert into auth.sessions(id,user_id) values($1,$1) on conflict do nothing", [user]);
  await db.exec(`begin; set local role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:user,session_id:user,aal:'aal1',role})]);
  await db.query("select set_config('request.jwt.claim.role',$1,true)", [role]);
  try {
    await db.exec('select public.assert_account_access()');
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function refused(user, fn, role) {
  try {
    await as(user, fn, role);
  } catch {
    return true;
  }
  return false;
}

// owner, peer (a personal chat with the owner), group mate, stranger, blocker (a personal chat too).
const names = ["owner", "peer", "groupmate", "stranger", "blocker"];
const [o, p, g, s, k] = names.map((_, n) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, "0")}`);
const ids = [o, p, g, s, k];
await db.exec(`insert into auth.users(id, email) values ${ids.map((id, n) => `('${id}', '${names[n]}@example.invalid')`).join(", ")};`);
for (const [n, id] of ids.entries()) {
  await as(id, () => db.query("update public.profiles set username = $2 where id = $1", [id, `${names[n]}_user`]));
}

const iso = (value) => (value == null ? null : new Date(value).toISOString());
const seenAt = { [o]: "2026-11-03T10:00:00.000Z", [p]: "2026-11-03T09:00:00.000Z", [k]: "2026-11-03T08:00:00.000Z" };
// Stamped the way the app does it: each account updates its own row.
for (const [id, at] of Object.entries(seenAt)) {
  const stamped = await as(id, () => db.query("update public.profiles set last_seen_at = $2 where id = $1", [id, at]));
  assert.equal(stamped.affectedRows, 1, "an account stamps its own time");
}

const direct = async (from, to) => (await as(from, () => db.query("select public.create_direct_chat($1) as id", [to]))).rows[0].id;
await direct(o, p);
await direct(k, o);
const group = (await db.query("insert into public.chats(title, is_group, created_by) values ('горы', true, $1) returning id", [o])).rows[0].id;
await db.query("insert into public.chat_members(chat_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')", [group, o, g]);

const lastSeen = async (viewer, targets = [o]) => {
  const { rows } = await as(viewer, () => db.query("select id, last_seen_at from public.last_seen_of($1::uuid[])", [targets]));
  return Object.fromEntries(rows.map((row) => [row.id, iso(row.last_seen_at)]));
};
const seenOf = async (viewer, target = o) => (await lastSeen(viewer, [target]))[target];
const single = async (viewer, target = o) =>
  iso((await as(viewer, () => db.query("select public.visible_last_seen($1) as at", [target]))).rows[0].at);
const hide = (value, user = o) => as(user, () => db.query("update public.profiles set hide_last_seen = $2 where id = $1", [user, value]));

// 1. The column is closed for direct reading - for strangers, for peers, for anon and for the owner too.
assert.ok(await refused(s, () => db.query("select last_seen_at from public.profiles where id = $1", [o])), "a stranger reads it directly");
assert.ok(await refused(p, () => db.query("select last_seen_at from public.profiles where id = $1", [o])), "so does a peer");
assert.ok(await refused(o, () => db.query("select last_seen_at from public.profiles where id = $1", [o])), "the column is closed for everybody");
assert.ok(await refused(s, () => db.query("select * from public.profiles")), "select * would include it");
assert.ok(await refused(s, () => db.query("select id from public.profiles where last_seen_at > now() - interval '1 year'")), "nor can it be probed in a filter");
assert.ok(await refused(null, () => db.query("select last_seen_at from public.profiles"), "anon"), "anon reads it");
assert.ok(await refused(null, () => db.query("select * from public.last_seen_of(array[$1]::uuid[])", [o]), "anon"), "anon calls last_seen_of");
assert.ok(await refused(null, () => db.query("select public.visible_last_seen($1)", [o]), "anon"), "anon calls visible_last_seen");
ok("время «был(а) в сети» не читается из таблицы напрямую — ни посторонним, ни собеседником, ни анонимом, ни самим владельцем");

// 2. What the app reads and writes keeps working.
const basics = await as(s, () => db.query("select id, username, display_name, avatar, hide_last_seen from public.profiles order by id"));
assert.equal(basics.rows.length, ids.length);
const own = await as(o, () =>
  db.query("select display_name, avatar, username, profile_visibility, message_policy, details_visibility, hide_last_seen, disable_read_receipts from public.profiles where id = $1", [o])
);
assert.equal(own.rows[0].hide_last_seen, false, "visible is the default");
assert.equal((await as(s, () => db.query("select count(*)::int as n from public.profiles"))).rows[0].n, ids.length, "count still works");
await as(o, () =>
  db.query(
    `insert into public.profiles(id, display_name, avatar, updated_at) values ($1, 'Owner', 'O', now())
     on conflict (id) do update set display_name = excluded.display_name, avatar = excluded.avatar, updated_at = excluded.updated_at`,
    [o]
  )
);
const foreign = await as(s, () => db.query("update public.profiles set last_seen_at = now() where id = $1", [o]));
assert.equal(foreign.affectedRows ?? 0, 0, "nobody stamps someone else's time");
await as(g, () => db.query("select public.touch_last_seen()"));
assert.notEqual(iso((await db.query("select last_seen_at from public.profiles where id = $1", [g])).rows[0].last_seen_at), null, "touch_last_seen still stamps");
assert.ok(await refused(null, () => db.query("select public.may_see_last_seen($1)", [o]), "anon"), "the rule is not for anon");
assert.ok(await refused(s, () => db.query("select avatar_path from public.profiles")), "the photo stays closed (20261057)");
ok("имя, буква, ник и свои настройки читаются как раньше; время ставится, как ставило приложение; фото по-прежнему закрыто");

// 3. Switch off, the default: people who share a personal chat see the time, nobody else does.
assert.equal(await seenOf(p), seenAt[o], "a peer");
assert.equal(await seenOf(k), seenAt[o], "the other peer");
assert.equal(await seenOf(o), seenAt[o], "the owner");
assert.equal(await seenOf(g), null, "someone who only shares a group");
assert.equal(await seenOf(s), null, "a stranger");
assert.deepEqual(await lastSeen(s), { [o]: null }, "hidden comes back as null, the same as never seen - not as a missing row");
assert.deepEqual(await lastSeen(p, [o, k, g, s]), { [o]: seenAt[o], [k]: null, [g]: null, [s]: null }, "several at once, each by the rule");
assert.equal(await single(p), seenAt[o], "visible_last_seen: the peer");
assert.equal(await single(s), null, "visible_last_seen: the stranger");
assert.equal(await single(g), null, "visible_last_seen: the group mate");
assert.deepEqual(await lastSeen(p, []), {}, "nobody asked, nobody answered");
assert.deepEqual((await as(p, () => db.query("select * from public.last_seen_of(null)"))).rows, [], "null is nobody");
ok("переключатель выключен: время видят те, с кем есть личный чат, и сам владелец; посторонний и участник общей группы — нет");

// 4. Switch on: nobody but the owner.
await hide(true);
for (const viewer of [p, k, g, s]) {
  assert.equal(await seenOf(viewer), null);
  assert.equal(await single(viewer), null);
}
assert.equal(await seenOf(o), seenAt[o], "the owner still sees their own");
assert.equal(await seenOf(o, p), seenAt[p], "and still sees a peer who did not hide theirs");
await hide(false);
assert.equal(await seenOf(p), seenAt[o], "switching back shows it again");
ok("переключатель включён: время не видит никто, кроме владельца; выключение возвращает как было");

// 5. A block hides it in both directions, whatever the switch says.
await as(k, () => db.query("select public.block_user($1)", [o]));
assert.equal(await seenOf(k), null, "the blocker does not see the blocked");
assert.equal(await seenOf(o, k), null, "the blocked does not see the blocker");
assert.equal(await single(o, k), null, "nor through visible_last_seen");
assert.equal(await seenOf(p), seenAt[o], "everyone else still does");
await as(k, () => db.query("select public.unblock_user($1)", [o]));
assert.equal(await seenOf(o, k), seenAt[k], "unblocking shows it again");
ok("блокировка скрывает время в обе стороны, разблокировка возвращает");

// 6. Running this migration or the one before it again changes nothing.
await hide(true, p);
await db.exec(migration);
await db.exec(migration);
await db.exec(photoMigration);
assert.ok(await refused(s, () => db.query("select last_seen_at from public.profiles")), "still closed");
assert.ok(await refused(s, () => db.query("select about from public.profiles")), "the about line still closed");
assert.equal((await as(s, () => db.query("select count(*)::int as n from public.profiles where display_name is not null"))).rows[0].n, ids.length, "names still readable");
assert.equal(await seenOf(p), seenAt[o]);
assert.equal(await seenOf(s), null);
assert.equal(await seenOf(o, p), null, "the switch is kept");
ok("повторный запуск этой миграции и предыдущей (фото) ничего не меняет");
} finally {
  await db.close();
}

console.log(`\nкто видит «был(а) в сети»: ${results.length} проверок пройдено`);
