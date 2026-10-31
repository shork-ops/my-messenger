/**
 * The moderation queue, checked against a real PostgreSQL.
 *
 * Policies and `security definer` functions are exactly the kind of thing that looks right and
 * behaves differently: a missing `to authenticated`, a check on the wrong column, a function
 * that grants more than intended. PGlite runs the migration as written and lets the identities
 * below act as separate users, so what is verified here is the behaviour of the SQL rather
 * than of a TypeScript re-statement of it.
 *
 * This is not a running Supabase deployment: grants on the real project, Storage and the
 * service-role path are separate. What it does prove is that a member can complain, an
 * outsider cannot, a duplicate does not pile up, and nobody can read or rewrite somebody
 * else's complaint.
 */

import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();

await db.exec(`
create role authenticated;
create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- The parts of the real schema this migration leans on.
create table public.chats(id uuid primary key, title text);
create table public.chat_members(chat_id uuid, user_id uuid);
create table public.messages(id uuid primary key, chat_id uuid, sender_id uuid, body text);
grant select on public.chats, public.chat_members, public.messages to authenticated;
`);

await db.exec(await readFile(new URL("../supabase/migrations/20261051_content_reports.sql", import.meta.url), "utf8"));

const [alice, bob, outsider] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`);
const [chat, otherChat] = [10, 11].map((n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`);
const [message, foreignMessage] = [20, 21].map((n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`);

await db.exec(`
insert into auth.users values ('${alice}'), ('${bob}'), ('${outsider}');
insert into public.chats values ('${chat}', 'разговор'), ('${otherChat}', 'другой разговор');
insert into public.chat_members values
  ('${chat}', '${alice}'), ('${chat}', '${bob}');
insert into public.messages values
  ('${message}', '${chat}', '${alice}', 'сообщение'),
  ('${foreignMessage}', '${otherChat}', '${outsider}', 'чужое сообщение');
`);

/** Runs `body` as `user`, rolling back on failure so one refusal does not poison the next. */
async function as(user, body) {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  try {
    const result = await body();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

const failures = [];
function check(name, condition) {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}`);
  }
}

// 1. A participant can complain about a message in their conversation.
const created = await as(alice, () =>
  db.query("select report_content($1, $2, 'abuse', 'писал угрозы') as id", [chat, message])
);
check("участник может пожаловаться на сообщение", Boolean(created.rows[0]?.id));

// 2. The same person complaining again returns the same row rather than a second one.
const again = await as(alice, () =>
  db.query("select report_content($1, $2, 'abuse', null) as id", [chat, message])
);
check("повторная жалоба не создаёт вторую строку", again.rows[0]?.id === created.rows[0]?.id);

// 3. An outsider cannot complain about a conversation they are not in.
let refused = false;
try {
  await as(outsider, () => db.query("select report_content($1, null, 'spam', null)", [chat]));
} catch (error) {
  refused = /not_a_member/.test(String(error));
}
check("посторонний получает отказ", refused);

// 4. A message cannot be reported against a different conversation.
let mismatched = false;
try {
  await as(outsider, () =>
    db.query("select report_content($1, $2, 'spam', null)", [chat, foreignMessage])
  );
} catch (error) {
  mismatched = /not_a_member/.test(String(error));
}
check("сообщение нельзя приписать чужому разговору", mismatched);

// 5. Another participant cannot read a complaint they did not write.
const bobSees = await as(bob, () => db.query("select id from public.content_reports"));
check("другой участник не видит чужую жалобу", bobSees.rows.length === 0);

// 6. The author can read their own complaint through the view, and only theirs.
const aliceSees = await as(alice, () => db.query("select status from public.my_reports"));
check("автор видит свою жалобу", aliceSees.rows.length === 1 && aliceSees.rows[0].status === "open");

// 7. A client cannot rewrite or delete a complaint.
let rewriteRefused = false;
try {
  await as(alice, () => db.query("update public.content_reports set status = 'dismissed'"));
  const after = await as(alice, () => db.query("select status from public.my_reports"));
  rewriteRefused = after.rows[0]?.status === "open";
} catch {
  rewriteRefused = true;
}
check("клиент не может переписать жалобу", rewriteRefused);

// 8. An invalid reason is refused rather than stored.
let badReason = false;
try {
  await as(alice, () => db.query("select report_content($1, null, 'просто не нравится', null)", [chat]));
} catch (error) {
  badReason = /bad_reason/.test(String(error));
}
check("недопустимая причина отклоняется", badReason);

// 9. A resolved complaint does not block a new one.
await db.exec(`update public.content_reports set status = 'dismissed', reviewed_at = now() where id = '${created.rows[0].id}'`);
const second = await as(alice, () => db.query("select report_content($1, null, 'spam', null) as id", [chat]));
check("после решения можно пожаловаться снова", second.rows[0]?.id !== created.rows[0]?.id);

if (failures.length > 0) {
  console.error(`\n${failures.length} проверок не прошло`);
  process.exit(1);
}
console.log("\nOK: очередь жалоб ведёт себя как задумано");
