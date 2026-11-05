import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`create role authenticator; create role authenticated; create role anon; create role service_role;
create schema auth; create schema storage;
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
grant usage on schema auth,public,storage to authenticated,anon,service_role;
create table public.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,endpoint text,p256dh text,auth text);
alter table public.push_subscriptions enable row level security;
create policy own_subscription on public.push_subscriptions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert on public.push_subscriptions to authenticated;
create table public.private_messages(body text); insert into public.private_messages values('private');
create table storage.objects(name text); insert into storage.objects values('private-file');
alter table public.private_messages enable row level security; alter table storage.objects enable row level security;
create policy allow_signed_in on public.private_messages for all to authenticated using(true) with check(true);
create policy allow_signed_in on storage.objects for all to authenticated using(true) with check(true);
grant select,insert on public.private_messages,storage.objects to authenticated;
create function public.definer_secret() returns text language sql security definer as $$select body from public.private_messages limit 1$$;
grant execute on function public.definer_secret() to authenticated;`);
const sql=await readFile(new URL('../supabase/migrations/20261060_account_access.sql',import.meta.url),'utf8');
await db.exec("do $hook$begin execute format('alter role authenticator in database %I set pgrst.db_pre_request=%L',current_database(),'');end$hook$");
await db.exec(sql); await db.exec(sql);
assert.equal((await db.query("select setconfig from pg_db_role_setting where setrole=(select oid from pg_roles where rolname='authenticator') and setdatabase=(select oid from pg_database where datname=current_database())")).rows[0].setconfig[0], 'pgrst.db_pre_request=public.assert_account_access');
const binding=await readFile(new URL('../supabase/migrations/20261061_push_session_binding.sql',import.meta.url),'utf8');
await db.exec(binding);await db.exec(binding);
const actor='00000000-0000-0000-0000-000000000001', other='00000000-0000-0000-0000-000000000002';
const session='00000000-0000-0000-0000-000000000010';
await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,actor]);
async function as(claims,fn){
 await db.exec('begin;set local role authenticated');
 await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',sub:actor,session_id:session,aal:'aal1',...claims})]);
 try {const out=await fn();await db.exec('commit');return out;}catch(e){await db.exec('rollback');throw e;}
}
const allowed=claims=>as(claims,async()=>{
 await db.exec('select public.assert_account_access()');
 assert.equal((await db.query('select * from private_messages')).rows.length,1);
 assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 assert.equal((await db.query('select definer_secret() secret')).rows[0].secret,'private');
});
async function denied(claims){
 await as(claims,async()=>{
  assert.equal((await db.query('select * from private_messages')).rows.length,0);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 });
 await assert.rejects(()=>as(claims,()=>db.exec('select public.assert_account_access(); select public.definer_secret();')), /session expired, revoked, or requires MFA/);
 await assert.rejects(()=>as(claims,()=>db.exec("insert into private_messages values('bypass')")),/row-level security/);
}
await allowed({});
await as({},()=>db.query("insert into push_subscriptions(user_id,endpoint,session_id) values($1,'device',$2)",[actor,other]));
assert.equal((await db.query("select session_id from push_subscriptions where endpoint='device'")).rows[0].session_id,session,'client cannot choose another push session');
await db.query("insert into push_subscriptions(user_id,endpoint) values($1,'legacy')",[actor]);
const eligible=async()=> (await db.query('select * from active_push_subscriptions($1)',[[actor]])).rows;
assert.equal((await eligible()).length,1,'legacy endpoint is not trusted');
await assert.rejects(()=>as({},()=>db.query('select * from active_push_subscriptions($1)',[[actor]])),/permission denied/);
await denied({session_id:null});await denied({session_id:'invalid'});await denied({sub:other});
await db.query("insert into auth.mfa_factors(user_id,status) values($1,'unverified')",[actor]);await allowed({});
await db.exec("update auth.mfa_factors set status='verified'");
await denied({});await denied({aal:null});await allowed({aal:'aal2'});
await db.exec("update auth.sessions set not_after=now()-interval '1 second'");await denied({aal:'aal2'});
assert.equal((await eligible()).length,0,'expired session receives no push');
await db.exec('update auth.sessions set not_after=null');
await db.exec('delete from auth.sessions');await denied({aal:'aal2'});
assert.equal((await eligible()).length,0);
assert.equal((await db.query("select * from push_subscriptions where endpoint='device'")).rows.length,0,'revocation deletes device subscription');
// A new deployment must not silently replace another API protection hook.
await db.exec("alter role authenticator set pgrst.db_pre_request='public.other_hook'");
await assert.rejects(()=>db.exec(sql),/Existing PostgREST hook/);await db.exec('rollback');
assert.ok((await db.query("select rolconfig from pg_roles where rolname='authenticator'")).rows[0].rolconfig.includes('pgrst.db_pre_request=public.other_hook'));
await db.exec("alter role authenticator reset pgrst.db_pre_request");
await db.exec("do $hook$begin execute format('alter role authenticator in database %I set pgrst.db_pre_request=%L',current_database(),'public.database_hook');end$hook$");
await assert.rejects(()=>db.exec(sql),/Existing PostgREST hook/);await db.exec('rollback');
await db.close();console.log('PASS: active session, MFA, revoked/expired/malformed session, RLS/Storage, RPC boundary, session-bound push and hook preservation');
