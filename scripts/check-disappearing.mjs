/**
 * Disappearing messages, checked against a real PostgreSQL.
 *
 * The timer is enforced by the database, so the database is what has to be tested: who may
 * change the timer, that a deadline cannot be forged by a modified client, that an expired
 * message stops being returned everywhere - by plain reads, by search, by the pinned list and
 * by single-view media - and that the clean-up job deletes it without destroying evidence a
 * moderator still has to look at.
 *
 * PGlite runs the migrations as written. Only the parts of the base schema they lean on are
 * recreated below (as in supabase/schema.sql); search, pins, single-view media and reports
 * come from their real migrations. This is not a Supabase deployment: pg_cron, Realtime and
 * Storage are not here, which is why the schedule itself is a step in the pull request.
 */

import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const db = new PGlite();
const migration = (name) => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

await db.exec(`
create role authenticated;
create role anon;
create role service_role;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public, storage to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
create publication supabase_realtime;

-- The base tables and rules from supabase/schema.sql that the migrations below lean on.
create table public.chats(
  id uuid primary key default gen_random_uuid(),
  title text not null default 'chat',
  is_group boolean not null default false,
  is_channel boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.chat_members(
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  primary key (chat_id, user_id)
);
create table public.messages(
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id),
  body text not null default '',
  attachment jsonb,
  send_at timestamptz,
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create table public.message_reactions(
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null,
  emoji text not null,
  primary key (message_id, user_id, emoji)
);
create table public.blocks(a uuid, b uuid);

create function public.is_chat_member(target_chat_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members cm
    where cm.chat_id = target_chat_id and cm.user_id = (select auth.uid()));
$$;
create function public.is_chat_admin(target_chat_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members cm
    where cm.chat_id = target_chat_id and cm.user_id = (select auth.uid()) and cm.role in ('owner', 'admin'));
$$;
create function public.is_blocked_between(uuid, uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks where (a = $1 and b = $2) or (a = $2 and b = $1));
$$;
grant execute on function public.is_chat_member(uuid), public.is_chat_admin(uuid) to authenticated;

alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
create policy "chats_select_members" on public.chats for select to authenticated using (public.is_chat_member(id));
create policy "chats_update_admin" on public.chats for update to authenticated
  using (public.is_chat_admin(id)) with check (public.is_chat_admin(id));
create policy "chat_members_select_members" on public.chat_members for select to authenticated
  using (public.is_chat_member(chat_id));
create policy "messages_select_members" on public.messages for select to authenticated using (
  public.is_chat_member(chat_id) and (send_at is null or send_at <= now() or sender_id = (select auth.uid()))
);
create policy "messages_insert_as_member" on public.messages for insert to authenticated with check (
  sender_id = (select auth.uid()) and public.is_chat_member(chat_id)
  and (send_at is null or (send_at > now() and send_at < now() + interval '1 year'))
);
create policy "messages_update_own" on public.messages for update to authenticated
  using (sender_id = (select auth.uid()) and public.is_chat_member(chat_id))
  with check (sender_id = (select auth.uid()) and public.is_chat_member(chat_id));
create policy "reactions_select_chat_members" on public.message_reactions for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_chat_member(m.chat_id))
);
grant select, insert, update, delete on public.chats to authenticated;
grant select on public.chat_members to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select on public.message_reactions to authenticated;
`);

for (const name of [
  "20261035_message_search",
  "20261036_pinned_messages",
  "20261050_view_once",
  "20261051_content_reports",
  "20261052_disappearing_messages",
]) {
  await db.exec(await migration(name));
}
// Somebody pressing Run twice in the SQL Editor must not break anything.
await db.exec(await migration("20261052_disappearing_messages"));

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [alice, bob, carol, outsider] = [1, 2, 3, 4].map(id);
const [direct, group, channel, plain] = [10, 11, 12, 13].map(id);
const HOUR = 3600;
const DAY = 86400;

await db.exec(`
insert into auth.users values ('${alice}'), ('${bob}'), ('${carol}'), ('${outsider}');
insert into public.chats (id, is_group, is_channel) values
  ('${direct}', false, false), ('${group}', true, false), ('${channel}', false, true), ('${plain}', false, false);
insert into public.chat_members (chat_id, user_id, role) values
  ('${direct}', '${alice}', 'owner'), ('${direct}', '${bob}', 'member'),
  ('${group}', '${alice}', 'owner'), ('${group}', '${bob}', 'admin'), ('${group}', '${carol}', 'member'),
  ('${channel}', '${alice}', 'owner'), ('${channel}', '${carol}', 'member'),
  ('${plain}', '${alice}', 'owner'), ('${plain}', '${bob}', 'member');
`);

/** Runs `body` as `user` (or anonymously), rolling back on failure so one refusal does not poison the next. */
async function as(user, body, role = "authenticated") {
  await db.exec(`begin; set local role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
  try {
    const result = await body();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function refused(body) {
  try {
    await body();
    return false;
  } catch {
    return true;
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

const setTimer = (user, chat, seconds) =>
  as(user, () => db.query("select public.set_chat_message_ttl($1, $2) as ttl", [chat, seconds]));
const timerOf = async (chat) =>
  (await db.query("select message_ttl_seconds as ttl from public.chats where id = $1", [chat])).rows[0].ttl;
const send = async (user, chat, body, extra = {}) => {
  const result = await as(user, () =>
    db.query(
      `insert into public.messages (chat_id, sender_id, body, send_at, expires_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [chat, user, body, extra.sendAt ?? null, extra.expiresAt ?? null],
    ),
  );
  return result.rows[0].id;
};
const row = async (message) =>
  (
    await db.query(
      `select expires_at, send_at,
              extract(epoch from expires_at - created_at)::bigint as life,
              extract(epoch from expires_at - send_at)::bigint as life_after_delivery
       from public.messages where id = $1`,
      [message],
    )
  ).rows[0];
/** Moves a deadline into the past, as time would. The trigger is bypassed on purpose. */
async function expire(message) {
  await db.exec("alter table public.messages disable trigger messages_set_expiry");
  await db.query("update public.messages set expires_at = now() - interval '1 minute' where id = $1", [message]);
  await db.exec("alter table public.messages enable trigger messages_set_expiry");
}

console.log("Таймер чата");
const bobSets = await setTimer(bob, direct, DAY);
check("в личном чате таймер может включить любой из двух", bobSets.rows[0].ttl === DAY && (await timerOf(direct)) === DAY);
check("в группе обычный участник таймер не меняет", await refused(() => setTimer(carol, group, HOUR)));
const adminSets = await setTimer(bob, group, HOUR);
check("в группе админ таймер меняет", adminSets.rows[0].ttl === HOUR && (await timerOf(group)) === HOUR);
check("в канале подписчик таймер не меняет", await refused(() => setTimer(carol, channel, DAY)));
await setTimer(alice, channel, 7 * DAY);
check("в канале владелец таймер меняет", (await timerOf(channel)) === 7 * DAY);
check("посторонний таймер не меняет", await refused(() => setTimer(outsider, direct, null)));
check("произвольный срок отклоняется", await refused(() => setTimer(alice, direct, 5)));
check("без входа таймер не меняется", await refused(() => as(null, () =>
  db.query("select public.set_chat_message_ttl($1, $2)", [direct, null]), "anon")));
check("в обход функции произвольный срок тоже не записать", await refused(() => as(alice, () =>
  db.query("update public.chats set message_ttl_seconds = 1 where id = $1", [group]))));
await as(carol, () => db.query("update public.chats set message_ttl_seconds = null where id = $1", [group]));
check("обычный участник группы не выключит таймер прямой записью", (await timerOf(group)) === HOUR);
check("чаты попадают в Realtime, чтобы таймер сразу увидел собеседник", (await db.query(
  "select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chats'")).rows.length === 1);

console.log("Срок жизни сообщения");
const beforeTimer = await send(alice, plain, "старое сообщение");
const live = await send(alice, direct, "живое сообщение", { expiresAt: "2999-01-01T00:00:00Z" });
check("срок ставит сервер по таймеру чата", (await row(live)).life === DAY);
const shortened = await send(alice, direct, "попытка сократить", { expiresAt: new Date(Date.now() + 1000).toISOString() });
check("срок, присланный приложением, не принимается", (await row(shortened)).life === DAY);
const forever = await send(alice, plain, "без таймера", { expiresAt: "2999-01-01T00:00:00Z" });
check("в чате без таймера сообщение не получает срок", (await row(forever)).expires_at === null);
const later = await send(alice, direct, "отложенное", { sendAt: new Date(Date.now() + 2 * HOUR * 1000).toISOString() });
check("у отложенного сообщения отсчёт идёт с момента доставки", (await row(later)).life_after_delivery === DAY);

await as(alice, () => db.query("update public.messages set expires_at = null where id = $1", [live]));
check("автор не может снять срок со своего сообщения", (await row(live)).life === DAY);
await as(alice, () => db.query("update public.messages set body = 'исправлено', edited_at = now() where id = $1", [live]));
check("правка текста срок не меняет", (await row(live)).life === DAY);
await as(alice, () => db.query("update public.messages set send_at = send_at + interval '1 hour' where id = $1", [later]));
check("перенос отложенного сообщения переносит и срок", (await row(later)).life_after_delivery === DAY);

await setTimer(alice, plain, HOUR);
check("включённый таймер не трогает уже написанные сообщения", (await row(beforeTimer)).expires_at === null);
await setTimer(alice, plain, null);
const afterOff = await send(alice, plain, "после выключения");
check("после выключения новые сообщения снова остаются", (await row(afterOff)).expires_at === null);

console.log("Истёкшее сообщение");
const gone = await send(alice, direct, "секретная встреча в пятницу");
const kept = await send(alice, direct, "встреча в пятницу отменяется");
await db.query("update public.messages set pinned_at = now(), pinned_by = $2 where id = any($1)", [[gone, kept], alice]);
await db.exec(`insert into public.message_reactions values ('${gone}', '${bob}', '❤️')`);
await expire(gone);
const bobReads = await as(bob, () => db.query("select id from public.messages where chat_id = $1", [direct]));
const ids = bobReads.rows.map((r) => r.id);
check("получатель истёкшее сообщение больше не видит", !ids.includes(gone) && ids.includes(kept));
const aliceReads = await as(alice, () => db.query("select id from public.messages where id = $1", [gone]));
check("автор тоже", aliceReads.rows.length === 0);
const found = await as(bob, () => db.query("select id from public.search_messages($1, 'пятницу')", [direct]));
const foundIds = found.rows.map((r) => r.id);
check("поиск истёкшее не находит, живое находит", !foundIds.includes(gone) && foundIds.includes(kept));
const pinned = await as(bob, () => db.query("select id from public.pinned_messages($1)", [direct]));
const pinnedIds = pinned.rows.map((r) => r.id);
check("в закреплённых истёкшего нет", !pinnedIds.includes(gone) && pinnedIds.includes(kept));
const edited = await as(alice, () => db.query("update public.messages set body = 'вернись' where id = $1 returning id", [gone]));
check("истёкшее сообщение нельзя «оживить» правкой", edited.rows.length === 0);

const scheduled = await send(alice, plain, "сюрприз в пятницу", { sendAt: new Date(Date.now() + HOUR * 1000).toISOString() });
const bobSearch = await as(bob, () => db.query("select id from public.search_messages($1, 'пятницу')", [plain]));
const aliceSearch = await as(alice, () => db.query("select id from public.search_messages($1, 'пятницу')", [plain]));
check("чужое отложенное сообщение не находится поиском до доставки",
  !bobSearch.rows.some((r) => r.id === scheduled) && aliceSearch.rows.some((r) => r.id === scheduled));

const path = `${direct}/${alice}/photo.jpg`;
const once = (
  await as(alice, () =>
    db.query("insert into public.messages (chat_id, sender_id, attachment) values ($1, $2, $3) returning id", [
      direct, alice, { viewOnce: true, bucket: "view-once-media", path },
    ]),
  )
).rows[0].id;
await expire(once);
check("одноразовое фото после истечения не открыть",
  await refused(() => as(bob, () => db.query("select public.claim_view_once_message($1)", [once]))));

console.log("Удаление");
check("пользователь не может запустить очистку", await refused(() =>
  as(alice, () => db.query("select public.purge_expired_messages()"))));
check("аноним тоже", await refused(() => as(null, () => db.query("select public.purge_expired_messages()"), "anon")));

const reported = await send(alice, direct, "угроза");
await expire(reported);
await db.query("insert into public.content_reports (reporter_id, message_id, reason) values ($1, $2, 'abuse')", [bob, reported]);
const purged = await as(null, () => db.query("select public.purge_expired_messages() as removed"), "service_role");
const remaining = (await db.query("select id from public.messages")).rows.map((r) => r.id);
check("очистка удаляет истёкшие", purged.rows[0].removed === 2 && !remaining.includes(gone) && !remaining.includes(once));
check("живые и бессрочные сообщения остаются", [live, kept, later, forever, beforeTimer].every((m) => remaining.includes(m)));
check("реакции уходят вместе с сообщением",
  (await db.query("select 1 from public.message_reactions where message_id = $1", [gone])).rows.length === 0);
check("сообщение с открытой жалобой ждёт модератора", remaining.includes(reported));
const stillHidden = await as(bob, () => db.query("select id from public.messages where id = $1", [reported]));
check("но участникам оно уже не видно", stillHidden.rows.length === 0);
await db.query("update public.content_reports set status = 'reviewed', reviewed_at = now() where message_id = $1", [reported]);
await as(null, () => db.query("select public.purge_expired_messages()"), "service_role");
check("после решения по жалобе удаляется и оно",
  (await db.query("select 1 from public.messages where id = $1", [reported])).rows.length === 0);

if (failures.length > 0) {
  console.error(`\n${failures.length} проверок не прошло`);
  process.exit(1);
}
console.log("\nOK: исчезающие сообщения ведут себя как задумано");
await db.close();
