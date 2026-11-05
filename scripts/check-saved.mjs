/**
 * «Избранное» in the cloud, checked against a real PostgreSQL.
 *
 * Saved messages are a table of their own with row level security, so the database is what is
 * tested: that an account adds, reads, corrects and removes its own saved messages, that only
 * the text can be corrected, that nobody else - the other person in the chat included - sees,
 * changes or removes them, that a row cannot be written in someone else's name, that an empty
 * row and a photo "to be seen once" are refused, and that running the migration again changes
 * nothing.
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

const savedMigration = await readFile(new URL("migrations/20261056_saved_messages.sql", root), "utf8");
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

async function refused(user, fn) {
  try {
    await as(user, fn);
  } catch {
    return true;
  }
  return false;
}

const [a, b] = [1, 2].map((n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`);
await db.exec(`insert into auth.users(id, email) values ('${a}', 'a@example.invalid'), ('${b}', 'b@example.invalid');`);

const save = (user, author, body, attachment = null) =>
  as(user, () => db.query("insert into public.saved_messages(author, body, attachment) values ($1, $2, $3) returning id, owner_id", [author, body, attachment]));
const list = (user) => as(user, () => db.query("select id, author, body, attachment from public.saved_messages order by created_at, id"));

// 1. The owner adds and reads their saved messages; the owner is taken from the session.
const first = (await save(a, "Мария", "Купить билеты")).rows[0];
assert.equal(first.owner_id, a, "the owner is whoever is signed in");
const photo = { name: "photo.jpg", type: "image/jpeg", size: 1200, path: `chat/${a}/photo.jpg` };
await save(a, "Вы", "", photo);
const own = (await list(a)).rows;
assert.equal(own.length, 2, "both saved messages are there");
assert.equal(own[0].body, "Купить билеты");
assert.equal(own[1].attachment.path, photo.path, "the attachment description is kept");
ok("своё избранное добавляется и читается, владелец берётся из входа");

// 2. Nobody else sees, changes or removes them.
assert.equal((await list(b)).rows.length, 0, "another account sees nothing");
const removedByOther = await as(b, () => db.query("delete from public.saved_messages where id = $1", [first.id]));
assert.equal(removedByOther.affectedRows ?? 0, 0, "another account removes nothing");
assert.equal((await list(a)).rows.length, 2, "still both");
const editedByOther = await as(b, () => db.query("update public.saved_messages set body = 'x' where id = $1", [first.id]));
assert.equal(editedByOther.affectedRows ?? 0, 0, "another account changes nothing");
assert.equal((await list(a)).rows[0].body, "Купить билеты", "the text is as saved");
ok("чужое избранное не видно, его нельзя удалить или изменить");

// 2a. The owner corrects the text, and only the text.
const corrected = await as(a, () => db.query("update public.saved_messages set body = 'Купить билеты на 5-е' where id = $1", [first.id]));
assert.equal(corrected.affectedRows, 1, "the owner corrects their own text");
assert.equal((await list(a)).rows[0].body, "Купить билеты на 5-е");
assert.ok(await refused(a, () => db.query("update public.saved_messages set owner_id = $1 where id = $2", [b, first.id])), "the owner cannot be changed");
assert.ok(await refused(a, () => db.query("update public.saved_messages set author = 'Кто-то' where id = $1", [first.id])), "the author cannot be changed");
assert.ok(await refused(a, () => db.query("update public.saved_messages set body = '' where id = $1", [first.id])), "a text-only row cannot be emptied");
ok("своё избранное можно поправить, но только текст");

// 3. A row cannot be written in someone else's name, and a signed-out visitor gets nothing.
assert.ok(await refused(b, () => db.query("insert into public.saved_messages(owner_id, body) values ($1, 'подброшено')", [a])), "no rows in another's name");
await db.exec("begin; set local role anon;");
let anonymous = "read";
try {
  await db.query("select * from public.saved_messages");
} catch {
  anonymous = "refused";
}
await db.exec("rollback");
assert.equal(anonymous, "refused", "a signed-out visitor cannot read the table");
ok("нельзя сохранить от чужого имени; без входа таблица недоступна");

// 4. Empty rows and photos "to be seen once" are refused.
assert.ok(await refused(a, () => db.query("insert into public.saved_messages(body) values ('')")), "an empty row is refused");
assert.ok(
  await refused(a, () => db.query("insert into public.saved_messages(body, attachment) values ('', $1)", [{ ...photo, viewOnce: true }])),
  "a view-once photo is refused",
);
assert.ok(await refused(a, () => db.query("insert into public.saved_messages(body) values ($1)", ["x".repeat(10001)])), "a huge text is refused");
ok("пустое, слишком длинное и фото «на один просмотр» не сохраняются");

// 5. The owner removes their own; running the migration again keeps what is there.
const removed = await as(a, () => db.query("delete from public.saved_messages where id = $1", [first.id]));
assert.equal(removed.affectedRows, 1, "the owner removes their own");
await db.exec(savedMigration);
await db.exec(savedMigration);
assert.equal((await list(a)).rows.length, 1, "a second run keeps what was there");
ok("своё удаляется; повторный запуск миграции ничего не ломает");

console.log(`\nOK: избранное в облаке работает как задумано (${results.length} проверок)`);
} catch (error) {
  // PGlite's own errors carry its whole bundle in the stack; the message and query are enough.
  console.error(`FAIL: ${error.message}${error.query ? `\n  query: ${error.query}` : ""}`);
  process.exitCode = 1;
}
await db.close();
