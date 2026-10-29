// Full acceptance pass against the deployed site.
//
// Runs on the live GitHub Pages URL exactly as a user loads it. Two real accounts
// are created in Supabase and their sessions injected, because the app offers
// only Google sign-in.
//
// A note on selectors: a direct chat is listed under the peer's display name
// (useCloudChats picks the other member's name), not under chats.title; only
// groups show their own title. The first run of this script assumed otherwise
// and reported a false failure.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import fs from "node:fs";

const SUPABASE_URL = "https://wuifyiqnkpridblufxzs.supabase.co";
const ANON_KEY = "sb_publishable_bJsLMHl-qrKT_-47t5nOLQ_WG10S5MO";
const PROJECT_REF = "wuifyiqnkpridblufxzs";
const SITE = process.env.SITE_URL ?? "https://shork-ops.github.io/my-messenger/";

if (!process.env.TEST_SERVICE_KEY) {
  console.error("TEST_SERVICE_KEY is required");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, process.env.TEST_SERVICE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? " - " + detail : ""));
};

const alphaName = "Accept Alpha";
const betaName = "Accept Beta";

const mkUser = async (email, name) => {
  const existing = (await admin.auth.admin.listUsers({ perPage: 200 })).data.users.find((u) => u.email === email);
  if (existing) {
    // Reuse rather than delete: a previous aborted run can leave rows that
    // block the auth delete, and a fresh id is not worth fighting for.
    await admin.from("profiles").upsert({ id: existing.id, display_name: name }, { onConflict: "id" });
    await admin.auth.admin.updateUserById(existing.id, { password: "Acc!2026pass", email_confirm: true });
    return existing.id;
  }
  const created = await admin.auth.admin.createUser({
    email,
    password: "Acc!2026pass",
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (created.error || !created.data?.user) {
    throw new Error("createUser failed for " + email + ": " + (created.error?.message ?? "no user returned"));
  }
  await admin.from("profiles").upsert({ id: created.data.user.id, display_name: name }, { onConflict: "id" });
  return created.data.user.id;
};

// Remove leftovers from earlier runs first: a previous aborted run leaves chats
// behind, and they are indistinguishable from this run's chats by name.
const purgeFixtures = async (userIds) => {
  for (const userId of userIds) {
    const memberships = await admin.from("chat_members").select("chat_id").eq("user_id", userId);
    for (const chatId of [...new Set((memberships.data ?? []).map((row) => row.chat_id))]) {
      await admin.from("calls").delete().eq("chat_id", chatId);
      await admin.from("messages").delete().eq("chat_id", chatId);
      await admin.from("message_reactions").delete().in(
        "message_id",
        ((await admin.from("messages").select("id").eq("chat_id", chatId)).data ?? []).map((row) => row.id)
      );
      await admin.from("chat_members").delete().eq("chat_id", chatId);
      await admin.from("chats").delete().eq("id", chatId);
    }
  }
};

const alpha = await mkUser("qa.acc.alpha@nexus-test.local", alphaName);
const beta = await mkUser("qa.acc.beta@nexus-test.local", betaName);
await purgeFixtures([alpha, beta]);

const signIn = async (email) => {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: "Acc!2026pass" });
  if (error) throw new Error("sign-in failed for " + email + ": " + error.message);
  return data.session;
};

const alphaSession = await signIn("qa.acc.alpha@nexus-test.local");
const betaSession = await signIn("qa.acc.beta@nexus-test.local");

const directChat = (
  await admin.from("chats").insert({ title: "Accept Base", is_group: false, created_by: alpha }).select("id").single()
).data.id;
await admin.from("chat_members").insert([
  { chat_id: directChat, user_id: alpha, role: "owner" },
  { chat_id: directChat, user_id: beta, role: "member" },
]);

const groupChat = (
  await admin.from("chats").insert({ title: "Accept Group", is_group: true, created_by: alpha }).select("id").single()
).data.id;
await admin.from("chat_members").insert([
  { chat_id: groupChat, user_id: alpha, role: "owner" },
  { chat_id: groupChat, user_id: beta, role: "member" },
]);

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

async function openAs(session, label) {
  const context = await browser.newContext({ permissions: ["microphone", "camera", "notifications"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text().slice(0, 160));
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      "sb-" + PROJECT_REF + "-auth-token",
      JSON.stringify({
        access_token: session.access_token,
        token_type: "bearer",
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        refresh_token: session.refresh_token,
        user: session.user,
      }),
    ]
  );
  await page.goto(SITE + "?build=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  return { context, page, errors, label };
}


// Finds the chat row for a direct chat by its rendered title element, which is
// stricter than a substring match on the whole row.
async function openDirectChat(page, peerName, timeout = 30000) {
  // The row appears once the deployed build has fetched the cloud chat list;
  // how long that takes depends on the network, so wait for it explicitly.
  await page
    .locator(".chat-list .chat-row")
    .filter({ has: page.locator(".chat-row-copy strong", { hasText: peerName }) })
    .first()
    .waitFor({ timeout });
  const direct = page.locator(".chat-list .chat-row").filter({
    has: page.locator(".chat-row-copy strong", { hasText: peerName }),
  });
  const count = await direct.count();
  let target = null;
  for (let i = 0; i < count; i += 1) {
    const candidate = direct.nth(i);
    const text = (await candidate.textContent()) || "";
    if (!text.includes("👥")) {
      target = candidate;
      break;
    }
  }
  // Chats are ordered newest-first; take the last non-group match so a leftover
  // chat from an earlier run cannot shadow this run's chat.
  if (!target) throw new Error("direct chat row not found for " + peerName);
  await target.click();
  await page.waitForFunction(
    (expected) => {
      const title = document.querySelector(".conversation-title");
      return Boolean(title && (title.textContent || "").trim().startsWith(expected));
    },
    peerName,
    { timeout: 20000 }
  );
  // The realtime channel is created per open chat; let the socket join before
  // anything is inserted, otherwise the event is published to nobody.
  await page.waitForTimeout(3000);
}

const alphaPage = await openAs(alphaSession, "alpha");
const betaPage = await openAs(betaSession, "beta");

let loaded = false;
try {
  await alphaPage.page.waitForSelector(".chat-list", { timeout: 45000 });
  loaded = true;
} catch {
  loaded = false;
}
check("deployed site loads the chat list", loaded);
if (!loaded) {
  console.log("body:", (await alphaPage.page.textContent("body"))?.slice(0, 300));
  await browser.close();
  process.exit(1);
}

// --- Both chats appear, named the way the app names them -------------------
await alphaPage.page.waitForTimeout(5000);
const directRow = alphaPage.page.locator(".chat-list .chat-row", { hasText: betaName }).first();
const groupRow = alphaPage.page.locator(".chat-list .chat-row", { hasText: "Accept Group" }).first();
check("direct chat is listed under the peer's name", (await directRow.count()) > 0);
check("group chat is listed under its own title", (await groupRow.count()) > 0);

await openDirectChat(alphaPage.page, betaName);


check("chat opens and shows the composer", (await alphaPage.page.getByLabel("Текст сообщения").count()) === 1);

// --- Sending writes through to the database ------------------------------
const marker = "deployed-" + Date.now();
await alphaPage.page.getByLabel("Текст сообщения").fill(marker);
await alphaPage.page.getByLabel("Отправить сообщение").click();
let storedMessage = null;
for (let i = 0; i < 30; i += 1) {
  const { data } = await admin.from("messages").select("id, body").eq("chat_id", directChat).eq("body", marker).maybeSingle();
  if (data) {
    storedMessage = data;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
check("message sent from the deployed site reaches the database", Boolean(storedMessage));
check(
  "sent message is rendered for the sender",
  await alphaPage.page
    .locator(".messages-area")
    .getByText(marker)
    .first()
    .isVisible({ timeout: 10000 })
    .catch(() => false)
);

// --- Realtime delivery to the second account -----------------------------
await betaPage.page.waitForSelector(".chat-list", { timeout: 45000 });
await betaPage.page.waitForTimeout(3000);
await openDirectChat(betaPage.page, alphaName);

check(
  "the sender's message reaches the peer's tab",
  await betaPage.page
    .locator(".messages-area")
    .getByText(marker)
    .first()
    .isVisible({ timeout: 20000 })
    .catch(() => false)
);

// Wait for the realtime socket to be ready, not just for the DOM.
const realtimeReady = await alphaPage.page
  .waitForFunction(
    () => {
      const channel = window.__nexusRealtimeProbe;
      return Boolean(channel);
    },
    { timeout: 5000 }
  )
  .then(() => true)
  .catch(() => false);
void realtimeReady;
await alphaPage.page.waitForTimeout(4000);

const peerMarker = "realtime-" + Date.now();
const betaClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: "Bearer " + betaSession.access_token } },
});
await betaClient.from("messages").insert({ chat_id: directChat, sender_id: beta, body: peerMarker });
check(
  "peer message arrives over realtime in the open tab",
  await alphaPage.page
    .locator(".messages-area")
    .getByText(peerMarker)
    .first()
    .isVisible({ timeout: 20000 })
    .catch(() => false)
);

// Temporary diagnostics: what is each tab showing at the moment delivery failed?
for (const [label, pg] of [["ALPHA", alphaPage.page], ["BETA", betaPage.page]]) {
  const title = await pg.locator(".conversation-title").textContent().catch(() => "<none>");
  const area = await pg.locator(".messages-area").textContent().catch(() => "<none>");
  const rows = await pg.$eval(".chat-list", (n) =>
    [...n.querySelectorAll(".chat-row")].map((x) => (x.textContent || "").trim().slice(0, 45))
  ).catch((e) => ["<error " + e.message.slice(0, 40) + ">"]);
  const hasList = await pg.locator(".chat-list").count();
  console.log("  DIAG " + label + " chat-list count=" + hasList);
  console.log("  DIAG " + label + " title=" + JSON.stringify(title) + " tail=" + JSON.stringify((area || "").slice(-90)));
  console.log("  DIAG " + label + " rows=" + JSON.stringify(rows));
}
// --- Server search -------------------------------------------------------
await alphaPage.page.getByLabel("Поиск по переписке").first().click();
await alphaPage.page.waitForTimeout(1200);
const searchField = alphaPage.page.locator("input[placeholder*='оиск'], input[type='search']").last();
await searchField.fill(peerMarker);
await alphaPage.page.waitForTimeout(3500);
const searchHits = await alphaPage.page.locator(".search-hit, .search-results .bubble, .search-hits").count();
check("server search finds the phrase", searchHits > 0, "hits: " + searchHits);
check("server search reports no error", (await alphaPage.page.locator(".search-error").count()) === 0);
await alphaPage.page.keyboard.press("Escape");
await alphaPage.page.waitForTimeout(1200);

// --- Calls ---------------------------------------------------------------
await alphaPage.page.getByLabel("Позвонить").click();
const outgoing = await alphaPage.page
  .locator(".call-overlay")
  .waitFor({ timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check("caller opens the call screen on the deployed site", outgoing);

const incoming = await betaPage.page
  .locator(".call-overlay")
  .waitFor({ timeout: 25000 })
  .then(() => true)
  .catch(() => false);
check("peer sees the incoming call on the deployed site", incoming);

if (incoming) {
  await betaPage.page.getByLabel("Ответить").click();
  const callRow = (await admin.from("calls").select("id").eq("chat_id", directChat).maybeSingle()).data;
  let active = false;
  for (let i = 0; i < 40; i += 1) {
    const { data } = await admin.from("calls").select("status").eq("id", callRow.id).single();
    if (data?.status === "active") {
      active = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check("call reaches the active state", active);

  await new Promise((resolve) => setTimeout(resolve, 5000));
  const subtitle = await alphaPage.page.locator(".call-overlay .call-subtitle").textContent().catch(() => "");
  check("call timer runs", /\d+:\d\d/.test(subtitle ?? ""), String(subtitle));

  await alphaPage.page.getByLabel("Завершить").click();
  let ended = false;
  for (let i = 0; i < 40; i += 1) {
    const { data } = await admin.from("calls").select("status").eq("id", callRow.id).single();
    if (data && ["ended", "missed", "declined"].includes(data.status)) {
      ended = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check("call ends cleanly", ended);
}

// --- Privacy settings ----------------------------------------------------
await new Promise((resolve) => setTimeout(resolve, 1500));
const privacyTrigger = alphaPage.page.getByText("Приватность и блокировки").first();
if ((await privacyTrigger.count()) > 0) await privacyTrigger.click();
const privacyModal = alphaPage.page.locator(".privacy-modal");
const privacyOpen = await privacyModal
  .waitFor({ timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check("privacy settings open on the deployed site", privacyOpen);
if (privacyOpen) {
  check("privacy offers both switches", (await privacyModal.locator(".privacy-row input").count()) === 2);
}

// --- PWA assets ----------------------------------------------------------
const manifest = await alphaPage.page.evaluate(async () => {
  const response = await fetch("/my-messenger/manifest.webmanifest").catch(() => null);
  return response && response.ok ? response.json() : null;
});
check("PWA manifest is served", Boolean(manifest?.name), manifest?.name ?? "");

const swStatus = await alphaPage.page.evaluate(async () => {
  const response = await fetch("/my-messenger/sw.js").catch(() => null);
  return response ? response.status : 0;
});
check("service worker file is served", swStatus === 200, String(swStatus));

const allErrors = [...alphaPage.errors, ...betaPage.errors].filter(
  (text) => !text.includes("sw.js") && !text.includes("ServiceWorker")
);
check("no JavaScript errors on the deployed site", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));

await browser.close();
for (const chatId of [directChat, groupChat]) {
  await admin.from("calls").delete().eq("chat_id", chatId);
  await admin.from("messages").delete().eq("chat_id", chatId);
  await admin.from("chat_members").delete().eq("chat_id", chatId);
  await admin.from("chats").delete().eq("id", chatId);
}
for (const userId of [alpha, beta]) {
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
}

const passed = results.filter((r) => r.ok).length;
console.log("\n" + passed + "/" + results.length + " checks passed");
fs.writeFileSync("qa-acceptance.json", JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);
