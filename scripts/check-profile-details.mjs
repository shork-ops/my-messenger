/**
 * «Кто видит фото и „О себе“», checked against a real PostgreSQL.
 *
 * The setting is only worth something if the database keeps to it, so the database is what is
 * tested: that the photo and the about line can no longer be read from the table directly by
 * anybody, that `profile_details` gives them to everyone, to contacts only or to nobody as the
 * owner chose, that a "contact" is someone the owner has written to in a personal chat - not
 * someone who merely opened a chat, sits in the same group or got a message that is still
 * scheduled - that a block hides both in both directions, that the search and the avatars bucket
 * follow the same rule, that the owner still reads and changes their own, that the columns the
 * app reads stay readable, and that running the migration again changes nothing.
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
create role authenticated; create role anon; create role service_role;
create schema auth; create schema storage; create schema extensions;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now(), updated_at timestamptz default now(), not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet);
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

const migration = await readFile(new URL("migrations/20261057_profile_details_privacy.sql", root), "utf8");
for (const file of files) await db.exec(await readFile(new URL(file, root), "utf8"));

const results = [];
try {
function ok(label) {
  results.push(label);
  console.log(`  ok  ${label}`);
}

async function as(user, fn, role = "authenticated") {
  await db.exec(`begin; set local role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
  try {
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

// owner, contact, stranger, opener (wrote first, never answered), group mate, blocker.
const names = ["owner", "contact", "stranger", "opener", "groupmate", "blocker"];
const [o, c, s, x, g, k] = names.map((_, n) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, "0")}`);
const ids = [o, c, s, x, g, k];
await db.exec(`insert into auth.users(id, email) values ${ids.map((id, n) => `('${id}', '${names[n]}@example.invalid')`).join(", ")};`);
for (const [n, id] of ids.entries()) {
  await as(id, () => db.query("update public.profiles set username = $2 where id = $1", [id, `${names[n]}_user`]));
}
const photo = `${o}/photo.webp`;
await as(o, () => db.query("update public.profiles set avatar_path = $2, about = 'Люблю горы' where id = $1", [o, photo]));
await as(k, () => db.query("update public.profiles set avatar_path = $2, about = 'Тоже горы' where id = $1", [k, `${k}/me.webp`]));
await db.query("insert into storage.objects(bucket_id, name, owner) values ('avatars', $1, $2), ('avatars', $3, $4)", [photo, o, `${k}/me.webp`, k]);

const send = (user, chat, body = "привет") => as(user, () => db.query("insert into public.messages(chat_id, body) values ($1, $2)", [chat, body]));
const direct = async (from, to) => (await as(from, () => db.query("select public.create_direct_chat($1) as id", [to]))).rows[0].id;
const details = async (viewer, target = o) =>
  (await as(viewer, () => db.query("select avatar_path, about from public.profile_details(array[$1]::uuid[])", [target]))).rows[0];
const sees = async (viewer, target = o) => {
  const row = await details(viewer, target);
  assert.equal(Boolean(row.avatar_path), Boolean(row.about), "photo and about follow one rule");
  return Boolean(row.avatar_path);
};
const listsPhoto = async (viewer, owner = o) =>
  (await as(viewer, () => db.query("select count(*)::int as n from storage.objects where bucket_id = 'avatars' and name like $1", [`${owner}/%`]))).rows[0].n > 0;
const searchPhoto = async (viewer) =>
  (await as(viewer, () => db.query("select avatar_path from public.search_profiles('owner')"))).rows[0]?.avatar_path ?? null;
const setVisibility = (value, user = o) =>
  as(user, () => db.query("update public.profiles set details_visibility = $2 where id = $1", [user, value]));

// The conversations that decide who is a contact.
const oc = await direct(o, c);
await send(o, oc);
const xo = await direct(x, o);
await send(x, xo, "здравствуйте, вы меня не знаете");
const group = (await db.query("insert into public.chats(title, is_group, created_by) values ('горы', true, $1) returning id", [o])).rows[0].id;
await db.query("insert into public.chat_members(chat_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')", [group, o, g]);
await send(o, group, "всем привет");
const ok_ = await direct(o, k);
await send(o, ok_);
const os = await direct(o, s);
await as(o, () => db.query("insert into public.messages(chat_id, body, send_at) values ($1, 'завтра', now() + interval '1 day')", [os]));

// 1. The columns are closed for direct reading - for strangers, for anon and for the owner too.
assert.ok(await refused(s, () => db.query("select avatar_path from public.profiles where id = $1", [o])), "a stranger reads the photo path directly");
assert.ok(await refused(s, () => db.query("select about from public.profiles where id = $1", [o])), "a stranger reads the about line directly");
assert.ok(await refused(o, () => db.query("select avatar_path, about from public.profiles where id = $1", [o])), "the columns are closed for everybody");
assert.ok(await refused(s, () => db.query("select * from public.profiles")), "select * would include them");
assert.ok(await refused(null, () => db.query("select about from public.profiles"), "anon"), "anon reads the about line");
assert.ok(await refused(null, () => db.query("select * from public.profile_details(array[$1]::uuid[])", [o]), "anon"), "anon calls profile_details");
assert.ok(await refused(s, () => db.query("select public.has_written_to($1, $2)", [o, s])), "the helper is not for callers");
ok("фото и «о себе» не читаются из таблицы напрямую — ни посторонним, ни анониму, ни самому владельцу");

// 2. What the app reads stays readable.
// «был(а) в сети» is closed by the next migration (20261058) and has its own check.
const basics = await as(s, () => db.query("select id, display_name, avatar, username from public.profiles order by id"));
assert.equal(basics.rows.length, ids.length);
const own = await as(o, () => db.query("select display_name, avatar, username, profile_visibility, message_policy, details_visibility, hide_last_seen, disable_read_receipts from public.profiles where id = $1", [o]));
assert.equal(own.rows[0].details_visibility, "everyone", "everyone is the default");
await as(o, () =>
  db.query(
    `insert into public.profiles(id, display_name, avatar, updated_at) values ($1, 'Owner', 'O', now())
     on conflict (id) do update set display_name = excluded.display_name, avatar = excluded.avatar, updated_at = excluded.updated_at`,
    [o]
  )
);
ok("имя, буква, ник и свои настройки читаются как раньше; профиль сохраняется (upsert)");

// 3. Everyone, the default: a stranger sees both, in the search too, and may fetch the file.
assert.ok(await sees(s));
assert.deepEqual(await details(s), { avatar_path: photo, about: "Люблю горы" });
assert.equal(await searchPhoto(s), photo);
assert.ok(await listsPhoto(s));
ok("«Все»: посторонний видит фото и «о себе», фото есть в поиске и открывается");

// 4. Contacts only.
await setVisibility("contacts");
assert.ok(await sees(c), "someone the owner wrote to");
assert.ok(!(await sees(s)), "a stranger - the scheduled message has not arrived yet");
assert.ok(!(await sees(x)), "someone who wrote first and got no answer");
assert.ok(!(await sees(g)), "a member of a shared group");
assert.ok(await sees(o), "the owner");
assert.equal(await searchPhoto(s), null, "the search hides the photo from a stranger");
assert.ok(await listsPhoto(c), "a contact fetches the file");
assert.ok(!(await listsPhoto(s)), "a stranger cannot fetch the file");
assert.ok(!(await listsPhoto(x)), "nor can someone who only wrote first");
assert.deepEqual(await details(s), { avatar_path: null, about: null }, "hidden reads as not set");
ok("«Мои контакты»: видят те, кому владелец писал в личном чате; не видят посторонний, написавший первым, участник общей группы, получатель отложенного сообщения");

await send(o, xo, "здравствуйте!");
assert.ok(await sees(x), "an answer makes a contact");
ok("ответ в личном чате делает человека контактом");

// 5. Nobody.
await setVisibility("nobody");
for (const viewer of [c, s, x, g]) assert.ok(!(await sees(viewer)));
assert.ok(!(await listsPhoto(c)), "not even a contact fetches the file");
assert.ok(await sees(o), "the owner still sees their own");
assert.ok(await listsPhoto(o), "and can still reach the file");
ok("«Никто»: не видит никто, кроме самого владельца");

// 6. A block hides both whatever the setting, in both directions.
await setVisibility("everyone");
await as(k, () => db.query("select public.block_user($1)", [o]));
assert.ok(!(await sees(k)), "the blocker does not see the blocked");
assert.ok(!(await sees(o, k)), "the blocked does not see the blocker");
assert.ok(!(await listsPhoto(o, k)), "nor fetch the blocker's file");
assert.ok(await sees(s), "everyone else still does");
ok("блокировка скрывает фото и «о себе» в обе стороны при любой настройке");

// 7. The owner changes their own; nobody changes someone else's; nonsense is refused.
await as(o, () => db.query("update public.profiles set about = 'Люблю море', avatar_path = null where id = $1", [o]));
assert.deepEqual(await details(o), { avatar_path: null, about: "Люблю море" });
const foreign = await as(s, () => db.query("update public.profiles set details_visibility = 'everyone', about = 'взлом' where id = $1", [o]));
assert.equal(foreign.affectedRows ?? 0, 0, "another account's row is not updated");
assert.equal((await details(o)).about, "Люблю море");
assert.ok(await refused(o, () => setVisibility("friends")), "an unknown value");
const files = await as(s, () => db.query("select public.may_see_avatar_file('not-a-folder/photo.webp') as a, public.may_see_avatar_file(null) as b"));
assert.deepEqual(files.rows[0], { a: false, b: false }, "a path without an owner is nobody's photo");
ok("владелец меняет своё фото и «о себе»; чужой профиль не меняется; неизвестное значение и путь без владельца отклоняются");

// 8. Running the migration again changes nothing.
await as(o, () => db.query("update public.profiles set avatar_path = $2 where id = $1", [o, photo]));
await setVisibility("contacts");
await db.exec(migration);
await db.exec(migration);
assert.ok(await refused(s, () => db.query("select about from public.profiles")), "still closed");
assert.equal((await as(s, () => db.query("select count(*)::int as n from public.profiles"))).rows[0].n, ids.length, "count still works");
assert.ok(await sees(c));
assert.ok(!(await sees(s)));
assert.equal((await as(o, () => db.query("select details_visibility from public.profiles where id = $1", [o]))).rows[0].details_visibility, "contacts");
ok("повторный запуск миграции ничего не меняет");
} finally {
  await db.close();
}

console.log(`\nкто видит фото и «о себе»: ${results.length} проверок пройдено`);
