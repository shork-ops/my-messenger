// End-to-end call check against the live project and the real LiveKit SFU.
//
// Playwright cannot sign in (the app only offers Google OAuth), so the two
// sessions are created outside the browser and injected into localStorage, the
// same trick scripts/qa-two-accounts.mjs uses. Everything after that is real:
// RLS, the call RPCs, the Edge Function and the LiveKit room.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import fs from "node:fs";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.TEST_SERVICE_KEY;
const APP_URL = process.env.APP_URL ?? "http://localhost:4173";
const PROJECT_REF = "wuifyiqnkpridblufxzs";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / TEST_SERVICE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};

const mkUser = async (email, name) => {
  const existing = (await admin.auth.admin.listUsers({ perPage: 200 })).data.users.find((u) => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  const created = await admin.auth.admin.createUser({
    email,
    password: "Call!2026pass",
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  await admin.from("profiles").upsert({ id: created.data.user.id, display_name: name }, { onConflict: "id" });
  return created.data.user.id;
};

const alpha = await mkUser("qa.call.alpha@nexus-test.local", "QA Call Alpha");
const beta = await mkUser("qa.call.beta@nexus-test.local", "QA Call Beta");

const chat = (
  await admin.from("chats").insert({ title: "QA Call", is_group: false, created_by: alpha }).select("id").single()
).data.id;
await admin.from("chat_members").insert([
  { chat_id: chat, user_id: alpha, role: "owner" },
  { chat_id: chat, user_id: beta, role: "member" },
]);

const sessionFor = async (email) => {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: "Call!2026pass" });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { client, session: data.session };
};

const A = await sessionFor("qa.call.alpha@nexus-test.local");
const B = await sessionFor("qa.call.beta@nexus-test.local");

const storageFor = (session) => ({
  key: `sb-${PROJECT_REF}-auth-token`,
  value: JSON.stringify({
    access_token: session.access_token,
    token_type: "bearer",
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  }),
});

const browser = await chromium.launch({
  // Fake devices let the test publish real tracks without a microphone.
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

async function openAs(session, label) {
  const context = await browser.newContext({ permissions: ["microphone", "camera"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const stored = storageFor(session);
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [stored.key, stored.value]
  );
  await page.goto(APP_URL);
  await page.waitForSelector(".chat-list", { timeout: 20000 });
  return { context, page, errors, label };
}

const collectErrors = (viewer) => viewer.page.on("console", (msg) => {
  if (msg.type() === "error") viewer.errors.push(msg.text().slice(0, 200));
});

const alphaPage = await openAs(A.session, "alpha");
collectErrors(alphaPage);
const betaPage = await openAs(B.session, "beta");
collectErrors(betaPage);

const openChat = async (viewer, chatTitle) => {
  await viewer.page.locator(".chat-list .chat-row", { hasText: chatTitle }).first().click();
  await viewer.page.waitForSelector(".messages-area", { timeout: 10000 });
};

await openChat(alphaPage, "QA Call");
await openChat(betaPage, "QA Call");
check("both accounts see the call chat", true);

// --- Start the call from A -------------------------------------------------
await alphaPage.page.getByLabel("Позвонить").click();
const alphaOverlay = alphaPage.page.locator(".call-overlay");
await alphaOverlay.waitFor({ timeout: 15000 });
check("caller sees the outgoing call screen", true);

check(
  "caller sees no answer button",
  (await alphaPage.page.getByLabel("Ответить").count()) === 0
);

// --- B must see it ringing -------------------------------------------------
const betaOverlay = betaPage.page.locator(".call-overlay");
let incoming = true;
try {
  await betaOverlay.waitFor({ timeout: 20000 });
} catch {
  incoming = false;
}
check("peer sees the incoming call", incoming);

const callRow = (
  await admin.from("calls").select("id, status").eq("chat_id", chat).single()
).data;

if (incoming) {
  await betaPage.page.getByLabel("Ответить").click();
  // Waiting for the database keeps this deterministic.
  const answered = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const { data } = await admin.from("calls").select("status").eq("id", callRow.id).single();
      if (data?.status === "active") return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  })();
  check("call reaches the active state", answered);

  // Both sides must show the in-call screen, which only happens after the SFU
  // connection is established.
  const alphaInCall = await alphaPage.page
    .locator(".call-overlay")
    .evaluate((node) => !node.textContent.includes("Ответить"))
    .catch(() => false);
  check("caller switches to the in-call screen", alphaInCall);

  await new Promise((resolve) => setTimeout(resolve, 4000));
  const alphaSubtitle = await alphaPage.page.locator(".call-overlay .call-subtitle").textContent().catch(() => "");
  check("caller sees a running timer", /\d+:\d\d/.test(alphaSubtitle ?? ""), String(alphaSubtitle));
  const betaSubtitle = await betaPage.page.locator(".call-overlay .call-subtitle").textContent().catch(() => "");
  check("peer sees a running timer", /\d+:\d\d/.test(betaSubtitle ?? ""), String(betaSubtitle));

  // --- Mute toggles through the SFU ---------------------------------------
  await alphaPage.page.getByLabel("Выключить микрофон").click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const mutedNow = (await alphaPage.page.getByLabel("Включить микрофон").count()) === 1;
  check("mute toggles to the muted state", mutedNow);

  // --- Hang up ------------------------------------------------------------
  await alphaPage.page.getByLabel("Завершить").click();
  const ended = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const { data } = await admin.from("calls").select("status").eq("id", callRow.id).single();
      if (data && ["ended", "missed", "declined"].includes(data.status)) return data.status;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  })();
  check("call ends in the database", ended === "ended", String(ended));

  await alphaPage.page.waitForSelector(".call-overlay", { state: "detached", timeout: 10000 }).catch(() => {});
  check("overlay closes after hang-up", (await alphaPage.page.locator(".call-overlay").count()) === 0);

  // The peer's banner must not linger after the caller hangs up.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const betaOverlayGone = (await betaPage.page.locator(".call-overlay").count()) === 0;
  check("peer's call screen closes too", betaOverlayGone);
}

check("no JavaScript errors", alphaPage.errors.length === 0 && betaPage.errors.length === 0, [...alphaPage.errors, ...betaPage.errors].slice(0, 2).join(" | "));

// --- Cleanup ---------------------------------------------------------------
await browser.close();
await admin.from("calls").delete().eq("chat_id", chat);
await admin.from("chat_members").delete().eq("chat_id", chat);
await admin.from("chats").delete().eq("id", chat);
for (const userId of [alpha, beta]) {
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
fs.writeFileSync("qa-call-results.json", JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);

