/**
 * Live database check as an anonymous caller.
 *
 * The demo build exercises everything except the cloud, and the author cannot sign in as a
 * real user (Google is the only provider), so this is what can be measured from outside: a
 * caller with no session must be able to read nothing, write nothing, and call nothing.
 *
 * Run: node scripts/qa-cloud.mjs
 * Needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the environment (or .env).
 */
import fs from "node:fs";

const readEnv = () => {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };
  }
  const file = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const map = {};
  for (const line of file.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) map[match[1]] = match[2].trim();
  }
  return { url: map.SUPABASE_URL || map.VITE_SUPABASE_URL, key: map.VITE_SUPABASE_PUBLISHABLE_KEY };
};

const { url, key } = readEnv();
if (!url || !key) {
  console.log("Нет SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY — облачную проверку не провести.");
  process.exit(2);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const zero = "00000000-0000-0000-0000-000000000000";
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(46)} ${detail}`);
};

// Tables the app reads. RLS must return an empty set, not an error and not rows.
const tables = {
  profiles: "id,display_name,username,about,avatar_path",
  chats: "id,is_group,title,invite_code",
  messages: "id,chat_id,sender_id,body,created_at",
  chat_members: "chat_id,user_id,role,muted_until,archived_at",
  message_reactions: "message_id,user_id,emoji",
  calls: "id,chat_id,kind,status",
  push_subscriptions: "id",
  user_blocks: "blocker_id",
  message_hides: "message_id",
};
for (const [table, cols] of Object.entries(tables)) {
  const res = await fetch(`${url}/rest/v1/${table}?select=${cols}&limit=1`, { headers });
  const body = await res.json().catch(() => null);
  const empty = res.status === 200 && Array.isArray(body);
  const leaked = empty ? body.length === 0 : true;
  record(`чтение ${table}`, empty && leaked, `HTTP ${res.status}, строк ${Array.isArray(body) ? body.length : "—"}`);
}

// Writes. A caller with no session must be refused, and the refusal must be a policy error
// rather than a silent success.
for (const [table, row] of [
  ["messages", { chat_id: zero, sender_id: zero, body: "qa" }],
  ["profiles", { id: zero, display_name: "qa" }],
  ["message_reactions", { message_id: zero, user_id: zero, emoji: "x" }],
]) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  const refused = res.status >= 400;
  record(`запись ${table} без сессии`, refused, `HTTP ${res.status}`);
}

// Functions. Argument names come from the migrations: PostgREST resolves a function by its
// argument list, so a wrong name reads as "no such function" and looks like a missing RPC.
const rpcs = [
  ["create_direct_chat", { target_user_id: zero }],
  ["create_group_chat", { group_title: "qa" }],
  ["vote_on_poll", { message_id_input: zero, option_id_input: "a" }],
  ["mark_chat_read", { target_chat_id: zero }],
  ["set_message_pin", { target_message_id: zero, pinned: true }],
  ["pinned_messages", { target_chat_id: zero }],
  ["set_chat_preferences", { p_chat: zero, p_muted_until: null, p_archived: null }],
];
for (const [name, body] of rpcs) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const refused = res.status >= 400;
  const missing = res.status === 404;
  record(`функция ${name}`, refused && !missing, `HTTP ${res.status}${missing ? " (не найдена!)" : ""}`);
}

// The call token needs a session; that is the only thing standing between a stranger and a
// calling credential.
for (const fn of ["call-token"]) {
  const res = await fetch(`${url}/functions/v1/${fn}`, { method: "POST", headers, body: "{}" });
  record(`edge ${fn} без сессии`, res.status === 401, `HTTP ${res.status}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} из ${results.length} проверок пройдено`);
if (failed.length) {
  console.log("Провалено: " + failed.map((f) => f.name).join(", "));
  process.exit(1);
}
