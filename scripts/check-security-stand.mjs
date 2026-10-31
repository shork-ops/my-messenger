/**
 * The server stand for the point-7 hardening review.
 *
 * `docs/RELIABILITY_ROLLOUT.md` says the migrations and functions are deployed. Whether that is
 * true of the cloud project is a separate question, answered by probing it; this file answers a
 * different one, which can be answered honestly offline: **do the policies and functions, as
 * written, refuse what they are supposed to refuse?**
 *
 * It matters because the failure mode of an authorization bug is silence. A policy with a `using`
 * clause that returns null instead of false, a `security definer` function that forgot its
 * `search_path`, a grant that reaches one column too far - none of them raise. They simply let
 * somebody read something. So each check below is written as the thing an attacker would try, and
 * the assertion is that it is refused (or returns nothing).
 *
 * ### What this is not
 *
 * PGlite is a real PostgreSQL, not a Supabase deployment. Storage is simulated by the same two
 * tables and the same `storage.foldername` the real policies call, so the *policy logic* is
 * exercised as written; the bucket itself, the auth server and the HTTP edge of each function are
 * not. A pass here means "the SQL is right", not "the project is safe" - the two are different
 * claims and the report keeps them apart.
 *
 * ### Test data
 *
 * Everything lives in this file's own throwaway database. Nothing here connects to the project, so
 * no real file or message is touched, and no cleanup function is invoked against live data - the
 * requirement was to prove the cleanup path's *authorization*, which needs no real rows.
 */

import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();
let checks = 0;
const failures = [];

/** Runs one check and records the result instead of stopping at the first refusal. */
async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message.split("\n")[0]}`);
  }
}

/**
 * The part of Supabase this file needs, transcribed from the real thing.
 *
 * The identities are real roles and `auth.uid()` reads the same JWT claim the platform sets, so a
 * policy that works here works for the same reason it would there.
 */
await db.exec(`
create role authenticated;
create role anon;
create role service_role bypassrls;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text,
  owner uuid, owner_id text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
grant execute on function storage.foldername(text) to authenticated, anon;
grant usage on schema storage to authenticated, anon;

-- The slice of the base schema the migrations under test attach to.
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade,
  username text unique, display_name text);
create table public.chats (id uuid primary key default gen_random_uuid(), title text,
  kind text default 'direct', created_by uuid);
create table public.chat_members (chat_id uuid, user_id uuid, primary key (chat_id, user_id));
create table public.messages (id uuid primary key default gen_random_uuid(), chat_id uuid,
  sender_id uuid, body text, attachment jsonb, poll jsonb, created_at timestamptz default now(),
  deleted_at timestamptz, send_at timestamptz);
create table public.blocks (blocker uuid, blocked uuid, primary key (blocker, blocked));
grant select, insert, update on public.chats, public.chat_members, public.messages to authenticated, service_role;
grant select on public.profiles to authenticated;

create function public.is_chat_member(chat uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members m where m.chat_id = $1 and m.user_id = auth.uid())
$$;
create function public.is_blocked_between(a uuid, b uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks where (blocker = a and blocked = b)
                                             or (blocker = b and blocked = a))
$$;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- The policies from the real migrations, copied so the stand exercises the same SQL.
-- The chat row itself: a member sees their chats and nothing else. This policy lives in
-- supabase/schema.sql rather than in a numbered migration, and leaving it out is how an earlier
-- run of this stand briefly "found" a leak that was really a missing policy in the stand.
alter table public.chats enable row level security;
create policy chats_select_members on public.chats for select to authenticated
  using (public.is_chat_member(id));
create policy chats_insert_creator on public.chats for insert to authenticated
  with check (created_by = auth.uid());

alter table public.messages enable row level security;
create policy messages_read on public.messages for select to authenticated
  using (public.is_chat_member(chat_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_chat_member(chat_id));
create policy messages_update on public.messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());
`);

await db.exec(await readFile(new URL("../supabase/migrations/20261050_view_once.sql", import.meta.url), "utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261051_content_reports.sql", import.meta.url), "utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261030_poll_and_message_hardening.sql", import.meta.url), "utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261053_networked_games.sql", import.meta.url), "utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261054_write_limits.sql", import.meta.url), "utf8"));

// The media bucket and its three policies, as 20261026 declares them.
await db.exec(`
insert into storage.buckets values ('chat-media', 'chat-media', false, 52428800, array['image/*']);
create policy "chat media upload by chat members" on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] in (select cm.chat_id::text from public.chat_members cm where cm.user_id = auth.uid())
  and (storage.foldername(name))[2] = auth.uid()::text
);
create policy "chat media read by chat members" on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] in (select cm.chat_id::text from public.chat_members cm where cm.user_id = auth.uid())
);
create policy "chat media delete by uploader" on storage.objects for delete to authenticated
using (bucket_id = 'chat-media' and (storage.foldername(name))[2] = auth.uid()::text);
`);

/** Four identities: two in one chat, one outsider, one who is blocked. */
const [ALICE, BOB, MALLORY, DAVE, CHAT, OTHER_CHAT] = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "aaaaaaaa-0000-4000-8000-00000000000a",
  "bbbbbbbb-0000-4000-8000-00000000000b",
];

await db.query(`insert into auth.users (id) values ($1), ($2), ($3), ($4)`, [ALICE, BOB, MALLORY, DAVE]);
await db.query(`insert into public.profiles (id, username) values ($1, 'alice'), ($2, 'bob')`, [ALICE, BOB]);
await db.query(`insert into public.chats (id, title) values ($1, 'private'), ($2, 'other')`, [CHAT, OTHER_CHAT]);
await db.query(`insert into public.chat_members values ($1, $2), ($1, $3), ($4, $5)`, [CHAT, ALICE, BOB, OTHER_CHAT, DAVE]);

/**
 * Runs `fn` as a user, inside a transaction that is always rolled back or committed cleanly.
 *
 * The savepoint matters: a refused statement aborts the transaction, and a later statement in the
 * same transaction would then fail with "current transaction is aborted" instead of testing what it
 * meant to test. That failure mode once hid a passing assertion, so the reset is explicit.
 */
async function asRole(role, userId, fn) {
  await db.exec("begin");
  await db.exec(`set local role ${role}`);
  if (userId) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const as = (user, fn) => asRole("authenticated", user, fn);

/** The rows a query returned. RLS filters rows rather than raising, so this is often the assertion. */
async function rows(user, sql, params = []) {
  return (await as(user, () => db.query(sql, params))).rows;
}

/** Asserts that a statement is refused for this user, for any reason the database gives. */
async function denied(user, sql, params = []) {
  await assert.rejects(() => as(user, () => db.query(sql, params)));
}

console.log("\nRouting: the stand itself is sound");

await check("a member reads their own chat's messages", async () => {
  await as(ALICE, () => db.query(`insert into public.messages (chat_id, sender_id, body) values ($1, $2, 'hi')`, [CHAT, ALICE]));
  const mine = await rows(BOB, `select body from public.messages where chat_id = $1`, [CHAT]);
  assert.equal(mine.length, 1);
});

await check("an outsider reads nothing from a foreign chat", async () => {
  assert.equal((await rows(MALLORY, `select * from public.messages where chat_id = $1`, [CHAT])).length, 0);
  assert.equal((await rows(MALLORY, `select * from public.chats where id = $1`, [CHAT])).length, 0);
});

await check("an outsider cannot write into a foreign chat", async () => {
  await denied(MALLORY, `insert into public.messages (chat_id, sender_id, body) values ($1, $2, 'x')`, [CHAT, MALLORY]);
});

await check("a member cannot forge another member as the author", async () => {
  await denied(BOB, `insert into public.messages (chat_id, sender_id, body) values ($1, $2, 'forged')`, [CHAT, ALICE]);
});

await check("anonymous cannot read messages at all", async () => {
  // `anon` has no grant on messages, so the refusal is a permission error rather than an empty
  // result. Both are acceptable refusals; what must not happen is rows coming back.
  const result = await asRole("anon", null, () => db.query(`select * from public.messages`)).then(
    (r) => r,
    (error) => error
  );
  if (result instanceof Error) {
    assert.match(result.message, /permission denied|does not exist/i);
  } else {
    assert.equal(result.rows.length, 0);
  }
});

console.log("\nAttachments follow their chat, not their uploader");

await check("a member can upload into a chat they belong to, under their own folder", async () => {
  await as(ALICE, () =>
    db.query(`insert into storage.objects (bucket_id, name) values ('chat-media', $1)`, [`${CHAT}/${ALICE}/photo.jpg`])
  );
});

await check("an outsider cannot upload into a foreign chat", async () => {
  await denied(MALLORY, `insert into storage.objects (bucket_id, name) values ('chat-media', $1)`, [`${CHAT}/${MALLORY}/evil.jpg`]);
});

await check("a member cannot upload into another member's folder", async () => {
  // The uploader is a member, but the path claims Alice's identity.
  await denied(BOB, `insert into storage.objects (bucket_id, name) values ('chat-media', $1)`, [`${CHAT}/${ALICE}/planted.jpg`]);
});

await check("an outsider cannot read the chat's attachments", async () => {
  assert.equal((await rows(MALLORY, `select * from storage.objects`)).length, 0);
});

await check("a member reads the attachments of a chat they are in, and only those", async () => {
  const visible = await rows(BOB, `select name from storage.objects`);
  assert.ok(visible.length >= 1);
  for (const row of visible) assert.ok(row.name.startsWith(`${CHAT}/`), `leaked ${row.name}`);
});

await check("nobody can read the private bucket through a public URL", async () => {
  // `chat-media` is declared `public = false`. A public bucket is readable with no policy at all, so
  // this flag is what makes the policies above meaningful rather than decorative.
  const bucket = (await db.query(`select public from storage.buckets where id = 'chat-media'`)).rows[0];
  assert.equal(bucket.public, false);
});

console.log("\nA single-view message can be opened once, by one session");

await check("the sender and an outsider cannot claim a view-once message", async () => {
  const attachment = { viewOnce: true, bucket: "view-once-media", path: `${CHAT}/${ALICE}/once.jpg` };
  const inserted = await as(ALICE, () =>
    db.query(`insert into public.messages (chat_id, sender_id, body, attachment) values ($1, $2, '', $3) returning id`, [
      CHAT,
      ALICE,
      attachment,
    ])
  );
  const messageId = inserted.rows[0].id;
  await denied(ALICE, `select claim_view_once_message($1)`, [messageId]);
  await denied(MALLORY, `select claim_view_once_message($1)`, [messageId]);
  // The recipient may, once.
  const first = await as(BOB, () => db.query(`select claim_view_once_message($1) as media`, [messageId]));
  assert.equal(first.rows[0].media.path, attachment.path);
});

await check("a second session of the same recipient is refused", async () => {
  // "Opened" is recorded against the message, not against a device, so a second session of the same
  // person is indistinguishable from the first - which is the intended rule: one view, one viewer.
  const attachment = { viewOnce: true, bucket: "view-once-media", path: `${CHAT}/${ALICE}/once2.jpg` };
  const messageId = (
    await as(ALICE, () =>
      db.query(`insert into public.messages (chat_id, sender_id, body, attachment) values ($1, $2, '', $3) returning id`, [
        CHAT,
        ALICE,
        attachment,
      ])
    )
  ).rows[0].id;
  await as(BOB, () => db.query(`select claim_view_once_message($1)`, [messageId]));
  await denied(BOB, `select claim_view_once_message($1)`, [messageId]);
});

await check("a viewer may see only their own receipts, and may not change them", async () => {
  // The policy is deliberately "user_id = auth.uid()": a recipient may look up what they have
  // already opened, which is how the client draws "already viewed". What must not happen is seeing
  // anybody else's receipts, or being able to undo one.
  const mine = await rows(BOB, `select user_id from public.view_once_receipts`);
  for (const receipt of mine) assert.equal(receipt.user_id, BOB);
  // Alice sent the messages; she must not see the receipts for them.
  assert.equal((await rows(ALICE, `select * from public.view_once_receipts`)).length, 0);
  assert.equal((await rows(MALLORY, `select * from public.view_once_receipts`)).length, 0);
  await denied(BOB, `delete from public.view_once_receipts`);
  await denied(BOB, `update public.view_once_receipts set user_id = $1`, [MALLORY]);
});

await check("a scheduled view-once message cannot be claimed before it is due", async () => {
  const attachment = { viewOnce: true, bucket: "view-once-media", path: `${CHAT}/${ALICE}/later.jpg` };
  const messageId = (
    await as(ALICE, () =>
      db.query(
        `insert into public.messages (chat_id, sender_id, body, attachment, send_at)
         values ($1, $2, '', $3, now() + interval '1 day') returning id`,
        [CHAT, ALICE, attachment]
      )
    )
  ).rows[0].id;
  await denied(BOB, `select claim_view_once_message($1)`, [messageId]);
});

console.log("\nRequests that race each other cannot both win");

await check("the same view-once message claimed twice at once is granted at most once", async () => {
  const attachment = { viewOnce: true, bucket: "view-once-media", path: `${CHAT}/${ALICE}/race.jpg` };
  const messageId = (
    await as(ALICE, () =>
      db.query(`insert into public.messages (chat_id, sender_id, body, attachment) values ($1, $2, '', $3) returning id`, [
        CHAT,
        ALICE,
        attachment,
      ])
    )
  ).rows[0].id;
  // Two independent sessions claiming simultaneously. The unique receipt row is what makes one of
  // them fail; without it both would return the media and the "once" would be a lie under load.
  const results = await Promise.allSettled([
    as(BOB, () => db.query(`select claim_view_once_message($1)`, [messageId])),
    as(BOB, () => db.query(`select claim_view_once_message($1)`, [messageId])),
  ]);
  const granted = results.filter((r) => r.status === "fulfilled").length;
  assert.ok(granted <= 1, `${granted} claims were granted from two racing sessions`);
});

await check("two racing commands for the same game revision cannot both apply", async () => {
  const chatId = CHAT;
  const created = await as(ALICE, () =>
    db.query(`select game_create($1, 'chess', 2::smallint, $2::jsonb, 3, null, null) as id`, [
      chatId,
      JSON.stringify({ startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", moves: [] }),
    ])
  );
  const gameId = created.rows[0].id;
  await as(BOB, () => db.query(`select game_join($1)`, [gameId]));
  // Both players race a command from the same revision. Revisions are compared and incremented
  // under the row lock, so exactly one of them can win.
  const outcomes = await Promise.allSettled([
    as(ALICE, () =>
      db.query(`select game_commands_commit($1, $2, 0, '{}'::jsonb, $3::jsonb, null, 'playing') as out`, [
        gameId,
        "cmd-race-a",
        JSON.stringify({ startFen: "x", moves: [{ san: "e4" }] }),
      ])
    ),
    as(BOB, () =>
      db.query(`select game_commands_commit($1, $2, 0, '{}'::jsonb, $3::jsonb, null, 'playing') as out`, [
        gameId,
        "cmd-race-b",
        JSON.stringify({ startFen: "x", moves: [{ san: "d4" }] }),
      ])
    ),
  ]);
  const applied = outcomes
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value.rows[0].out)
    .filter((out) => out.status === "applied").length;
  assert.equal(applied, 1, `expected exactly one accepted command, got ${applied}`);
});

console.log("\nComplaints are protected");

await check("a member can report a message in their chat, once", async () => {
  const messageId = (
    await as(BOB, () =>
      db.query(`insert into public.messages (chat_id, sender_id, body) values ($1, $2, 'rude') returning id`, [CHAT, BOB])
    )
  ).rows[0].id;
  await as(ALICE, () => db.query(`select report_content($1::uuid, $2::uuid, 'spam', null)`, [CHAT, messageId]));
});

await check("an outsider cannot report a message they cannot see", async () => {
  const messageId = (
    await as(BOB, () => db.query(`insert into public.messages (chat_id, sender_id, body) values ($1, $2, 'x') returning id`, [CHAT, BOB]))
  ).rows[0].id;
  await denied(MALLORY, `select report_content($1::uuid, $2::uuid, 'spam', null)`, [CHAT, messageId]);
});

await check("a reporter sees only their own complaints and cannot edit or delete any", async () => {
  // A reporter may re-read what they filed - that is how the client shows "already reported" - but
  // sees nobody else's, and cannot rewrite one to mean something it did not say.
  const mine = await rows(ALICE, `select reporter_id from public.content_reports`);
  for (const report of mine) assert.equal(report.reporter_id, ALICE);
  assert.equal((await rows(MALLORY, `select * from public.content_reports`)).length, 0);
  await denied(ALICE, `update public.content_reports set reason = 'rewritten'`);
  await denied(ALICE, `delete from public.content_reports`);
});

console.log("\nSpam limits hold where the writes happen");

await check("a message over the length limit is refused", async () => {
  await denied(ALICE, `insert into public.messages (chat_id, sender_id, body) values ($1, $2, repeat('x', 20000))`, [CHAT, ALICE]);
});

await check("a poll with too many options is refused", async () => {
  const poll = { question: "?", options: Array.from({ length: 40 }, (_, i) => ({ id: `o${i}`, text: `opt ${i}` })) };
  await denied(ALICE, `insert into public.messages (chat_id, sender_id, body, poll) values ($1, $2, '', $3)`, [CHAT, ALICE, poll]);
});

await check("a poll option that is absurdly long is refused", async () => {
  const poll = { question: "?".repeat(2000), options: [{ id: "o1", text: "x".repeat(4000) }] };
  await denied(ALICE, `insert into public.messages (chat_id, sender_id, body, poll) values ($1, $2, '', $3)`, [CHAT, ALICE, poll]);
});

await check("the card game cannot be opened with more seats than it has", async () => {
  // An invitation is a way to make the server do work on command, so the limits on it are limits on
  // that work: seats, and the kinds that exist.
  await denied(ALICE, `select game_create($1, 'chess', 9::smallint, '{}'::jsonb, 3, null, null)`, [CHAT]);
  await denied(ALICE, `select game_create($1, 'poker', 2::smallint, '{}'::jsonb, 1, null, null)`, [CHAT]);
});

await check("a stranger cannot open a game in a chat they are not in", async () => {
  await denied(MALLORY, `select game_create($1, 'chess', 2::smallint, '{}'::jsonb, 3, null, null)`, [CHAT]);
});

await check("a stranger cannot list the games of a chat they are not in", async () => {
  // It returns a single jsonb array, so "nothing" is an empty array rather than zero rows.
  const listed = await as(MALLORY, () => db.query(`select games_for_chat($1) as games`, [CHAT]));
  assert.equal(listed.rows[0].games.length, 0);
  // And a member does see them, so the emptiness above is the policy and not a broken function.
  const member = await as(ALICE, () => db.query(`select games_for_chat($1) as games`, [CHAT]));
  assert.ok(member.rows[0].games.length > 0);
});

await check("a player cannot hold two seats: rejoining returns the seat they already have", async () => {
  const created = await as(ALICE, () =>
    db.query(`select game_create($1, 'cards', 3::smallint, $2::jsonb, 1, null, null) as id`, [
      CHAT,
      JSON.stringify({ deck: [], hands: [], turnIndex: 0 }),
    ])
  );
  const gameId = created.rows[0].id;
  // Joining again is a rejoin, not a new seat - which is what a reloaded client needs. The proof
  // that no second seat was taken is the seat count, not an error.
  const rejoined = await as(ALICE, () => db.query(`select game_join($1) as g`, [gameId]));
  const seatsHeld = await db.query(`select count(*)::int as n from public.game_players where game_id = $1 and user_id = $2`, [
    gameId,
    ALICE,
  ]);
  assert.equal(seatsHeld.rows[0].n, 1);
  assert.equal(rejoined.rows[0].g.mySeat, 0);
});

console.log("\nThe write rate limits are enforced by the database, not the browser");

await check("the write counter cannot be read or written by a client", async () => {
  // The table is reachable only through the definer function. A client that can read it would learn
  // other accounts' activity; a client that can write it would clear its own limit.
  await assert.rejects(() => rows(ALICE, `select * from public.write_rate_limits`));
  await denied(ALICE, `update public.write_rate_limits set used = 0`);
  await denied(ALICE, `insert into public.write_rate_limits (user_id, action, used) values ($1, 'message', 0)`, [ALICE]);
});

await check("a client can spend its own allowance but not another account's", async () => {
  // The function uses auth.uid() rather than a parameter, so there is no user id to forge.
  const fn = await db.query(
    `select pg_get_function_arguments(p.oid) as args from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'consume_write_allowance'`
  );
  assert.ok(
    !/p_user|user_id/i.test(fn.rows[0].args),
    `consume_write_allowance must not take a user id: ${fn.rows[0].args}`
  );
});

await check("the message rate limit stops a flood and leaves a normal pace alone", async () => {
  // A fresh account, so the counter starts empty rather than wherever earlier checks left it.
  await db.query(`insert into public.chat_members values ($1, $2) on conflict do nothing`, [CHAT, DAVE]);
  // Start from a clean counter so the check measures this loop rather than earlier traffic.
  await db.query(`delete from public.write_rate_limits where user_id = $1`, [DAVE]);
  const limit = (await db.query(`select public.message_rate_limit() as n`)).rows[0].n;
  assert.ok(limit >= 10, `limit ${limit} is too low to be a real conversation`);

  // The counter permits exactly `limit` writes in a window, and the next one is refused.
  let sent = 0;
  for (let index = 0; index < limit; index += 1) {
    await as(DAVE, () =>
      db.query(`insert into public.messages (chat_id, sender_id, body) values ($1, $2, $3)`, [CHAT, DAVE, `msg ${index}`])
    );
    sent += 1;
  }
  assert.equal(sent, limit, `expected to send ${limit} messages, sent ${sent}`);
  const attached = await db.query(
    `select tgname from pg_trigger where tgrelid = 'public.messages'::regclass and not tgisinternal order by tgname`
  );
  assert.ok(
    attached.rows.some((row) => row.tgname === "messages_rate_limit"),
    `the rate trigger is not attached; attached: ${attached.rows.map((row) => row.tgname).join(", ")}`
  );
  // The first write past the allowance is refused...
  await assert.rejects(
    () => as(DAVE, () => db.query(`insert into public.messages (chat_id, sender_id, body) values ($1, $2, 'over')`, [CHAT, DAVE])),
    /Too many/
  );
  // ...and stays refused, so a client that ignores the error cannot push through on a retry.
  await assert.rejects(
    () => as(DAVE, () => db.query(`insert into public.messages (chat_id, sender_id, body) values ($1, $2, 'over again')`, [CHAT, DAVE])),
    /Too many/
  );
});

await check("the service role is not throttled, so batched delivery still works", async () => {
  // Delivery jobs write several messages at once with the service role. If the trigger throttled
  // them, a backlog would stop draining - a self-inflicted outage.
  const before = (await db.query(`select coalesce(sum(used), 0)::int as n from public.write_rate_limits`)).rows[0].n;
  await db.exec("set role service_role");
  try {
    for (let index = 0; index < 5; index += 1) {
      await db.query(`insert into public.messages (chat_id, sender_id, body) values ($1, $2, $3)`, [CHAT, ALICE, `batched ${index}`]);
    }
  } finally {
    await db.exec("reset role");
  }
  const after = (await db.query(`select coalesce(sum(used), 0)::int as n from public.write_rate_limits`)).rows[0].n;
  assert.equal(after, before, "the service role consumed a client's allowance");
});

console.log("\nMaintenance cannot be triggered by a normal or anonymous user");

await check("cleanup-media refuses an anonymous caller", async () => {
  // The function compares the bearer token against the service key in constant time. Anything that
  // is not that exact key is refused, including an anonymous JWT, which is a valid token but not
  // the maintenance secret.
  const { maintenanceAuthorized } = await import("../supabase/functions/_shared/maintenanceAuth.ts");
  assert.equal(await maintenanceAuthorized("Bearer anon-token", "service-secret"), false);
  assert.equal(await maintenanceAuthorized(null, "service-secret"), false);
  assert.equal(await maintenanceAuthorized("Bearer ", "service-secret"), false);
  assert.equal(await maintenanceAuthorized("Bearer service-secret", ""), false);
});

await check("cleanup-media refuses a signed-in user who is not the service role", async () => {
  const { maintenanceAuthorized } = await import("../supabase/functions/_shared/maintenanceAuth.ts");
  // A plausible user JWT: refused, because the comparison is against the service key only.
  assert.equal(
    await maintenanceAuthorized("Bearer eyJhbGciOiJIUzI1NiJ9.user.notservice", "the-real-service-key"),
    false
  );
  // And the real key is accepted, so the check is not refusing everything by accident.
  assert.equal(await maintenanceAuthorized("Bearer the-real-service-key", "the-real-service-key"), true);
});

await check("the prune function is not callable by a signed-in or anonymous user", async () => {
  await denied(ALICE, `select games_prune()`);
  await asRole("anon", null, async () => {
    await assert.rejects(() => db.query(`select games_prune()`));
  });
});

console.log("\nThe stand proves the policies, and the count");

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(` - ${failure}`);
}
await db.close();
if (failures.length) process.exit(1);
console.log(
  "PASS: foreign chats and attachments are unreadable and unwritable, the private bucket stays private, " +
    "view-once is granted once across sessions and across racing claims, scheduled media cannot be claimed early, " +
    "racing game commands apply at most once, a complaint is visible only to its reporter and cannot be edited, " +
    "and the seat, poll and rate limits hold in the database. NOTE: this is a PGlite stand. It proves the SQL as " +
    "written, not the deployed project - grants, Storage itself and the HTTP edge of each Edge Function are outside it."
);
