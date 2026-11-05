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

// New public tables must retain the account boundary, not just permissive RLS.
const missingAccountPolicies = await db.query(`
  select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
    and c.relkind='r' and not exists (
      select 1 from pg_policy p where p.polrelid=c.oid
        and p.polname='nexus_account_access' and not p.polpermissive
    ) order by 1`);
assert.deepEqual(missingAccountPolicies.rows, [], 'every protected table has a restrictive account policy');

const [a, b, c] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
await db.exec(`insert into auth.users(id, email) values ('${a}', 'a@example.invalid'), ('${b}', 'b@example.invalid'), ('${c}', 'c@example.invalid');`);
await db.exec(`insert into auth.sessions(id,user_id) select id,id from auth.users;`);
assert.equal((await db.query('select count(*)::int as n from public.profiles')).rows[0].n, 3, 'signing up creates a profile');

async function as(user, fn) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({session_id:user,aal:'aal1',role:'authenticated'})]);
  await db.query("select set_config('request.jwt.claim.role','authenticated',true)");
  await db.exec('select public.assert_account_access()');
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


// Recovery traverses more than one page and respects scheduled visibility and hides.
await db.query("insert into public.messages(chat_id,sender_id,body,created_at) select $1,$2,'gap-'||n,'2003-01-01'::timestamptz from generate_series(1,250) n",[chat,a]);
await db.query("insert into public.messages(chat_id,sender_id,body,created_at,send_at) values($1,$2,'old scheduled','2000-01-01','2002-01-01'),($1,$2,'future','2000-01-01',now()+interval '1 day')",[chat,a]);
await as(b,()=>db.query("insert into public.message_hides(message_id,user_id) select id,$1 from public.messages where body='gap-1'",[b]));
const recovered=[];let cursor=null;
for(let page=0;page<10;page++){
 const batch=(await as(b,()=>db.query("select * from public.recover_chat_messages($1,'2001-01-01',$2,100)",[chat,cursor]))).rows;
 recovered.push(...batch);if(batch.length<100)break;cursor=batch.at(-1).id;
}
assert.equal(recovered.length,251,'all gap messages, hello and due scheduled row, minus hidden');
assert.equal(new Set(recovered.map(row=>row.id)).size,251);
assert.ok(recovered.some(row=>row.body==='old scheduled'));
assert.ok(!recovered.some(row=>['future','gap-1'].includes(row.body)));
assert.equal((await as(c,()=>db.query("select * from public.recover_chat_messages($1,'2001-01-01')",[chat]))).rows.length,0,'recovery respects membership');
assert.ok(!(await as(a,()=>db.query("select * from public.recover_chat_messages($1,'2001-01-01',null,100)",[chat]))).rows.some(row=>row.body==='future'),'even sender does not recover future messages into history');

// A fresh device reads by delivery time, filters before LIMIT, then pages backwards.
await db.query("insert into public.messages(chat_id,sender_id,body,created_at,send_at) values($1,$2,'late delivery','1999-01-01','2025-01-01')",[chat,a]);
await db.query("insert into public.messages(id,chat_id,sender_id,body,created_at) values('ffffffff-ffff-ffff-ffff-fffffffffff1',$1,$2,'micro earlier','2024-01-01T00:00:00.123100Z'),('00000000-0000-0000-0000-000000000099',$1,$2,'micro later','2024-01-01T00:00:00.123900Z')",[chat,a]);
await as(b,()=>db.query("insert into public.message_hides(message_id,user_id) select id,$1 from public.messages where body like 'gap-%' and split_part(body,'-',2)::int<=60 on conflict do nothing",[b]));
const newest=(await as(b,()=>db.query("select * from public.message_history_page($1,null,null,50)",[chat]))).rows;
assert.equal(newest.length,50,'hidden rows must not make a page look exhausted');
assert.equal(newest[1].body,'late delivery','old creation time does not bury newly delivered scheduled message');
const expected=(await db.query("select id from public.messages m where chat_id=$1 and (send_at is null or send_at<=now()) and (expires_at is null or expires_at>now()) and not exists(select 1 from public.message_hides h where h.message_id=m.id and h.user_id=$2) order by timeline_at desc,id desc",[chat,b])).rows.map(row=>row.id);
const history=[];let beforeAt=null,beforeId=null;
for(let page=0;page<100;page++){
 const batch=(await as(b,()=>db.query("select to_jsonb(m) as item from public.message_history_page($1,$2,$3,7) m",[chat,beforeAt,beforeId]))).rows.map(row=>row.item);
 history.push(...batch);if(batch.length<7)break;
 beforeAt=batch.at(-1).timeline_at;beforeId=batch.at(-1).id;
}
assert.deepEqual(history.map(row=>row.id),expected,'first load plus all older pages match server timeline without gaps or duplicates');
const micro=(await as(b,()=>db.query("select body from public.message_history_page($1,'2024-01-01T00:00:00.123900Z','00000000-0000-0000-0000-000000000099',1)",[chat]))).rows;
assert.equal(micro[0].body,'micro earlier','cursor preserves sub-millisecond precision');
assert.equal((await as(c,()=>db.query("select * from public.message_history_page($1)",[chat]))).rows.length,0);
const future=(await db.query("select id from public.messages where body='future'")).rows[0].id;
assert.ok(!(await as(a,()=>db.query("select * from public.message_history_page($1)",[chat]))).rows.some(row=>row.id===future),'new-device history excludes own pending sends');
const pending=(await as(a,()=>db.query("select * from public.message_history_known($1,$2)",[chat,[future]]))).rows[0];
assert.equal(Object.values(pending)[0].history_pending,true,'known pending send is classified by server time');
assert.equal((await as(b,()=>db.query("select * from public.message_history_known($1,$2)",[chat,[future]]))).rows.length,0,'recipient never reads pending body');
await install('second run');

console.log(`PASS: ${files.length} files install on an empty project and again on top of themselves; every table has RLS; sign-up, direct chat and message visibility work.`);
await db.close();
