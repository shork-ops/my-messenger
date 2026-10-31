// Applies the three new migrations to a fresh database, in the documented order, and checks that the
// result is what the deploy guide promises.
//
// Each migration passing on its own does not prove they compose: 20261054 references functions from
// 20261053, and both assume the Supabase roles and the `storage` schema. This runs all three against a
// clean database, exactly as `supabase db push` would order them, and then repeats the whole sequence
// because the guide claims idempotency.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();

// The parts of a Supabase database these migrations touch: the roles they grant to, the storage schema
// they hang a trigger on, and the auth helpers the policies call.
await db.exec(`
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),''), '{}')::jsonb
$$;
grant usage on schema auth, storage, public to authenticated, anon, service_role;

-- Minimal stand-ins for the tables the migrations reference.
create table public.chats(id uuid primary key, owner uuid);
create table public.chat_members(chat_id uuid, user_id uuid, primary key(chat_id, user_id));
create table public.messages(
  id uuid primary key default gen_random_uuid(),
  chat_id uuid, sender_id uuid, body text, attachment jsonb,
  content_type text, kind text, created_at timestamptz default now()
);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
`);

const files = [
  "supabase/migrations/20261052_device_sessions.sql",
  "supabase/migrations/20261053_networked_games.sql",
  "supabase/migrations/20261054_write_limits.sql",
];

for (const file of files) {
  try {
    await db.exec(await readFile(file, "utf8"));
    console.log(`applied: ${file}`);
  } catch (error) {
    console.error(`FAILED: ${file}\n  ${error.message}`);
    process.exit(1);
  }
}

// The four tables the deploy guide tells the operator to expect.
const { rows: tables } = await db.query(`
  select table_name from information_schema.tables
  where table_schema = 'public'
    and table_name in ('device_sessions','games','game_players','write_rate_limits')
  order by table_name
`);
const names = tables.map((row) => row.table_name);
console.log("tables:", names.join(", "));
if (names.length !== 4) {
  console.error("FAILED: expected 4 tables");
  process.exit(1);
}

// The triggers that change live behaviour from the moment 20261054 is applied.
const { rows: triggers } = await db.query(`
  select tgname from pg_trigger where not tgisinternal
    and tgrelid in ('public.messages'::regclass, 'storage.objects'::regclass)
  order by tgname
`);
const triggerNames = triggers.map((row) => row.tgname);
console.log("triggers:", triggerNames.join(", "));
for (const expected of [
  "messages_rate_limit",
  "messages_invite_rate",
  "messages_sanitize_attachment",
  "storage_objects_rate_limit",
]) {
  if (!triggerNames.includes(expected)) {
    console.error(`FAILED: missing trigger ${expected}`);
    process.exit(1);
  }
}

// The body-length constraint must exist. On an empty table it should end up fully validated, because
// the migration validates it whenever no row is over the bound.
const { rows: constraint } = await db.query(`
  select convalidated from pg_constraint
  where conname = 'messages_body_length' and conrelid = 'public.messages'::regclass
`);
if (constraint.length !== 1) {
  console.error("FAILED: messages_body_length constraint missing");
  process.exit(1);
}
console.log("messages_body_length convalidated =", constraint[0].convalidated);
if (constraint[0].convalidated !== true) {
  console.error("FAILED: on an empty table the constraint should have been validated");
  process.exit(1);
}

// Re-running every file must be harmless: the guide tells the operator that they are idempotent.
for (const file of files) {
  try {
    await db.exec(await readFile(file, "utf8"));
  } catch (error) {
    console.error(`FAILED: ${file} is not idempotent\n  ${error.message}`);
    process.exit(1);
  }
}
console.log("re-run: all three files applied a second time without error");

console.log(
  "PASS: the three migrations apply in the documented order to a clean database, create the four " +
    "tables and four triggers, validate the length CHECK, and can be re-run safely"
);
