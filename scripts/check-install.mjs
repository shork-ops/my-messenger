// Installs the whole database from scratch, the way the README tells a person to:
// supabase/schema.sql, then every file in supabase/migrations in name order.
//
// Each migration is also checked on its own elsewhere, but only against a hand-made
// stand-in for the tables before it. That is how a broken schema.sql went unnoticed:
// every check passed while a fresh project could not be set up at all. This script runs
// the real chain, checks a few things a new install must get right, and then runs the
// chain a second time, because running a file again is the usual reaction to an error.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = new URL('../supabase/', import.meta.url);
const files = ['schema.sql', ...(await readdir(new URL('migrations/', root))).filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)];

const db = new PGlite({ extensions: { pgcrypto } });
// The parts of a Supabase project the files rely on but do not create.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema storage; create schema extensions;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
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

async function install(pass) {
  for (const file of files) {
    const sql = await readFile(new URL(file, root), 'utf8');
    // A byte-order mark is invisible in an editor but is a syntax error for the server.
    assert.ok(!sql.startsWith('\uFEFF'), `${file}: starts with a byte-order mark`);
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`${pass}: ${file} failed: ${error.message}`);
    }
  }
}

await install('first run');

const unprotected = await db.query(`
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
assert.deepEqual(unprotected.rows.map((r) => r.relname), [], 'every public table has row level security');

const [a, b, c] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
await db.exec(`insert into auth.users(id, email) values ('${a}', 'a@example.invalid'), ('${b}', 'b@example.invalid'), ('${c}', 'c@example.invalid');`);
assert.equal((await db.query('select count(*)::int as n from public.profiles')).rows[0].n, 3, 'signing up creates a profile');

async function as(user, fn) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  try { const result = await fn(); await db.exec('commit'); return result; } catch (error) { await db.exec('rollback'); throw error; }
}

await as(b, () => db.query("update public.profiles set username = 'second_user' where id = $1", [b]));
const chat = (await as(a, () => db.query('select public.create_direct_chat($1) as id', [b]))).rows[0].id;
assert.ok(chat, 'a direct chat can be started by username');
await as(a, () => db.query("insert into public.messages(chat_id, body) values ($1, 'hello')", [chat]));
assert.equal((await as(b, () => db.query('select body from public.messages'))).rows[0]?.body, 'hello', 'the other member reads the message');
assert.equal((await as(c, () => db.query('select * from public.messages'))).rows.length, 0, 'an outsider reads nothing');
await db.exec('begin; set local role anon;');
// Either a refusal or an empty answer is fine; seeing the message is not.
const anonymous = await db.query('select * from public.messages').then((r) => r.rows.length, () => 0);
await db.exec('rollback');
assert.equal(anonymous, 0, 'a signed-out visitor reads nothing');

await install('second run');

console.log(`PASS: ${files.length} files install on an empty project and again on top of themselves; every table has RLS; sign-up, direct chat and message visibility work.`);
await db.close();
