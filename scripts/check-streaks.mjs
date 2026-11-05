/**
 * «Огонёк дружбы», checked against a real PostgreSQL.
 *
 * The streak is counted in the database, so the database is what is tested: that a message in
 * a direct chat leaves a note and one in a group or a channel does not, that days are the
 * reader's days in their own time zone, that a run, its end and the record are right, that a
 * purged or deleted message does not put the fire out, that a scheduled message counts only
 * once it is sent, and that nobody reads another pair's notes.
 *
 * The whole chain is installed as a new project would be - supabase/schema.sql, then every
 * migration in order - because the trigger sits on a table that a dozen migrations shape.
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

const streakMigration = await readFile(new URL("migrations/20261055_friendship_streaks.sql", root), "utf8");
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
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
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

const [a, b, c] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`);
await db.exec(`insert into auth.users(id, email) values ('${a}', 'a@example.invalid'), ('${b}', 'b@example.invalid'), ('${c}', 'c@example.invalid');`);
await as(b, () => db.query("update public.profiles set username = 'second_user' where id = $1", [b]));
await as(c, () => db.query("update public.profiles set username = 'third_user' where id = $1", [c]));
const ab = (await as(a, () => db.query("select public.create_direct_chat($1) as id", [b]))).rows[0].id;
const ac = (await as(a, () => db.query("select public.create_direct_chat($1) as id", [c]))).rows[0].id;

// A group and a channel with the same two people in them, made directly.
const group = (await db.query("insert into public.chats(title, is_group, created_by) values ('group', true, $1) returning id", [a])).rows[0].id;
const channel = (await db.query("insert into public.chats(title, is_channel, created_by) values ('channel', true, $1) returning id", [a])).rows[0].id;
for (const chat of [group, channel]) {
  await db.query("insert into public.chat_members(chat_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')", [chat, a, b]);
}

const notes = async (chat, user) =>
  (await db.query("select count(*)::int as n from public.chat_activity where chat_id = $1 and user_id = $2", [chat, user])).rows[0].n;
const send = (user, chat, body = "hi") => as(user, () => db.query("insert into public.messages(chat_id, body) values ($1, $2)", [chat, body]));
const streaks = async (user, tz = "UTC") => (await as(user, () => db.query("select * from public.my_streaks($1)", [tz]))).rows;
const day = (offset) => db.query(`select ((now() at time zone 'UTC')::date + $1::int)::text as d`, [offset]).then((r) => r.rows[0].d);
const iso = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value));
/** A note at noon UTC, `offset` days from today. */
const noteAt = (chat, user, offset, hour = 12) =>
  db.query(
    `insert into public.chat_activity(chat_id, user_id, slot)
     values ($1, $2, public.activity_slot(((now() at time zone 'UTC')::date + $3::int + make_interval(hours => $4::int)) at time zone 'UTC'))
     on conflict do nothing`,
    [chat, user, offset, hour]
  );

// 1. Only direct chats leave notes.
await send(a, ab);
await send(a, group);
await send(a, channel);
assert.equal(await notes(ab, a), 1, "a message in a direct chat leaves a note");
assert.equal(await notes(group, a), 0, "a group message leaves none");
assert.equal(await notes(channel, a), 0, "a channel post leaves none");
await send(a, ab, "second in the same quarter hour");
assert.equal(await notes(ab, a), 1, "many messages in a quarter hour are one note");
ok("сообщение в личном чате оставляет отметку, в группе и канале — нет; много сообщений за 15 минут — одна отметка");

// 2. Three full days before today, and only one side today.
for (const offset of [-3, -2, -1]) {
  await noteAt(ab, a, offset);
  await noteAt(ab, b, offset);
}
let [row] = await streaks(a);
assert.equal(row.chat_id, ab);
assert.equal(iso(row.last_full), await day(-1), "the run ends yesterday");
assert.equal(row.run_days, 3);
assert.equal(row.today_mine, true);
assert.equal(row.today_theirs, false);
assert.equal(iso(row.today), await day(0));
ok("три дня подряд до вчера: серия 3, сегодня написал только я");

// 3. The other side writes today: the run grows to four, for both.
await send(b, ab);
[row] = await streaks(a);
assert.equal(iso(row.last_full), await day(0));
assert.equal(row.run_days, 4);
assert.equal(row.today_theirs, true);
const [theirs] = await streaks(b);
assert.equal(theirs.run_days, 4, "the other person sees the same run");
assert.equal(theirs.today_mine, true);
ok("собеседник ответил сегодня — серия 4 у обоих");

// 4. A day where only one wrote breaks the run; the record remembers an older, longer one.
for (const offset of [-20, -19, -18, -17, -16]) {
  await noteAt(ab, a, offset);
  await noteAt(ab, b, offset);
}
await noteAt(ab, a, -5);
await noteAt(ab, a, -4);
await noteAt(ab, b, -4);
[row] = await streaks(a);
assert.equal(row.run_days, 5, "-4..0 is one run: -5 had only one side and does not join it");
assert.equal(row.record_days, 5);
await noteAt(ab, b, -5);
[row] = await streaks(a);
assert.equal(row.run_days, 6);
assert.equal(row.record_days, 6, "the current run is the record when it is the longest");
ok("день, где писал только один, рвёт серию; рекорд помнит самую длинную");

// 5. Days are the reader's days.
const lateUtc = (offset, hour, minute) =>
  `((now() at time zone 'UTC')::date + ${offset} + make_interval(hours => ${hour}, mins => ${minute})) at time zone 'UTC'`;
await db.exec(`insert into public.chat_activity(chat_id, user_id, slot) values
  ('${ac}', '${a}', public.activity_slot(${lateUtc(-2, 23, 30)})),
  ('${ac}', '${c}', public.activity_slot(${lateUtc(-1, 0, 30)}));`);
assert.equal((await streaks(a, "UTC")).find((r) => r.chat_id === ac), undefined, "in UTC 23:30 and 00:30 are two days");
const novosibirsk = (await streaks(a, "Asia/Novosibirsk")).find((r) => r.chat_id === ac);
assert.ok(novosibirsk, "in Novosibirsk both are the same morning");
assert.equal(novosibirsk.run_days, 1);
const kathmandu = (await streaks(a, "Asia/Kathmandu")).find((r) => r.chat_id === ac);
assert.equal(kathmandu?.run_days, 1, "a +5:45 zone works too");
const mars = await streaks(a, "Mars/Olympus_Mons");
assert.equal(mars.find((r) => r.chat_id === ac), undefined, "an unknown zone is UTC, not an error");
assert.equal(mars.find((r) => r.chat_id === ab)?.run_days, 6);
ok("дни считаются по часовому поясу читателя (Новосибирск, Катманду), неизвестный пояс — как UTC");

// 6. Deleted and purged messages do not put the fire out.
await db.exec(`delete from public.messages where chat_id = '${ab}'`);
[row] = await streaks(a);
assert.equal(row.run_days, 6, "the notes stay when the messages go");
ok("удалённые и исчезнувшие сообщения не гасят огонёк");

// 7. A scheduled message counts once it has gone.
await db.exec("delete from public.chat_activity where chat_id = $1".replace("$1", `'${ac}'`));
await as(c, () => db.query("insert into public.messages(chat_id, body, send_at) values ($1, 'later', now() + interval '1 hour')", [ac]));
assert.equal(await notes(ac, c), 0, "a message still waiting is not counted");
await db.exec("alter table public.messages disable trigger messages_record_activity");
await db.query("insert into public.messages(chat_id, sender_id, body, send_at, created_at) values ($1, $2, 'sent', now() - interval '5 minutes', now() - interval '2 hours')", [ac, c]);
await db.exec("alter table public.messages enable trigger messages_record_activity");
await streaks(a);
assert.equal(await notes(ac, c), 1, "the first look after its moment records it");
ok("отложенное сообщение засчитывается, только когда ушло");

// 8. Nobody else reads them.
assert.equal((await streaks(c)).find((r) => r.chat_id === ab), undefined, "an outsider does not see another pair's streak");
const direct = await as(a, () => db.query("select * from public.chat_activity")).then((r) => r.rows.length, () => 0);
assert.equal(direct, 0, "the notes are not readable directly");
await db.exec("begin; set local role anon;");
const anonymous = await db.query("select * from public.my_streaks('UTC')").then(() => "answered", () => "refused");
await db.exec("rollback");
assert.equal(anonymous, "refused", "a signed-out visitor cannot ask");
ok("чужие серии не видны, таблицу напрямую не прочитать, без входа функция недоступна");

// 9. History from before the migration is counted, and running it again changes nothing.
await db.exec("alter table public.messages disable trigger messages_record_activity");
for (const [user, offset] of [[a, -9], [c, -9], [a, -8], [c, -8]]) {
  await db.query("insert into public.messages(chat_id, sender_id, body, created_at) values ($1, $2, 'old', now() - make_interval(days => $3::int))", [ac, user, -offset]);
}
await db.exec("alter table public.messages enable trigger messages_record_activity");
await db.exec(streakMigration);
await db.exec(streakMigration);
const backfilled = (await streaks(a)).find((r) => r.chat_id === ac);
assert.equal(backfilled?.run_days, 2, "two old days of both writing are found");
assert.equal(iso(backfilled.last_full), await day(-8));
assert.equal((await streaks(a)).find((r) => r.chat_id === ab)?.run_days, 6, "a second run keeps what was there");
ok("переписка до миграции учтена; повторный запуск миграции ничего не ломает");

console.log(`\nOK: огонёк дружбы считается как задумано (${results.length} проверок)`);
} catch (error) {
  // PGlite's own errors carry its whole bundle in the stack; the message and query are enough.
  console.error(`FAIL: ${error.message}${error.query ? `\n  query: ${error.query}` : ""}`);
  process.exitCode = 1;
}
await db.close();
