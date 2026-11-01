// Checks 20261053: the channel handle format and "delete for me" in search.
// Runs on a small stand-in for the tables the migration touches, like check-view-once.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
await db.exec(`
create role authenticated; create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, public to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
-- The handle column exactly as 20261049 left it, unanchored check included.
create table public.chats(id uuid primary key, is_channel boolean not null default true, title text);
alter table public.chats add column handle text check (handle is null or handle ~ '^[a-z0-9_]{3,32}');
create table public.chat_members(chat_id uuid, user_id uuid);
create function public.is_chat_member(uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.chat_members where chat_id=$1 and user_id=auth.uid()); $$;
create table public.messages(id uuid primary key, chat_id uuid, sender_id uuid, body text, created_at timestamptz default now(), edited_at timestamptz, deleted_at timestamptz, send_at timestamptz, expires_at timestamptz);
create table public.message_hides(message_id uuid, user_id uuid, primary key (message_id, user_id));
`);
await db.exec(await migration('20261035_message_search.sql'));
// A handle the old check let through: the migration must not fail on it, nor drop it.
await db.exec("insert into public.chats(id, handle) values ('00000000-0000-0000-0000-000000000099', 'abc-Old Handle')");
await db.exec(await migration('20261053_server_checks.sql'));
// Running it again must not fail either.
await db.exec(await migration('20261053_server_checks.sql'));

const [a, b, chat, hidden, kept, expired, later] = [1, 2, 10, 20, 21, 22, 23].map((n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
await db.query('insert into public.chats(id, handle) values ($1, $2)', [chat, 'good_handle']);
assert.equal((await db.query("select handle from public.chats where id = '00000000-0000-0000-0000-000000000099'")).rows[0].handle, 'abc-Old Handle');
for (const bad of ['abc-Anything Else!', 'ab', 'UPPER', 'x'.repeat(33)]) {
  await assert.rejects(() => db.query('update public.chats set handle = $1 where id = $2', [bad, chat]), `handle "${bad}" is refused`);
}

await db.exec(`insert into auth.users values ('${a}'), ('${b}'); insert into public.chat_members values ('${chat}', '${a}'), ('${chat}', '${b}');`);
await db.query(`insert into public.messages(id, chat_id, sender_id, body, expires_at, send_at) values
  ($1, $5, $6, 'apple hidden', null, null),
  ($2, $5, $6, 'apple kept', null, null),
  ($3, $5, $6, 'apple expired', now() - interval '1 minute', null),
  ($4, $5, $7, 'apple later', null, now() + interval '1 day')`, [hidden, kept, expired, later, chat, b, b]);
await db.query('insert into public.message_hides values ($1, $2)', [hidden, a]);

async function search(user) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  try {
    const { rows } = await db.query("select id from public.search_messages($1, 'apple')", [chat]);
    await db.exec('commit');
    return rows.map((r) => r.id).sort();
  } catch (error) { await db.exec('rollback'); throw error; }
}
assert.deepEqual(await search(a), [kept], 'search leaves out what the caller hid, expired and not-yet-sent messages');
assert.deepEqual(await search(b), [hidden, kept, later].sort(), 'hiding is per account; the sender finds their own scheduled message');

console.log('PASS: channel handle must match the whole format, old rows kept; search skips messages hidden by the caller, expired and scheduled ones; the migration runs twice.');
await db.close();
