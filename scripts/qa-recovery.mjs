// Live acceptance using disposable users, isolated browser storage and the local candidate client.
// Required: TEST_SUPABASE_URL, TEST_ANON_KEY, TEST_SERVICE_KEY. Never logs credentials.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
const url = process.env.TEST_SUPABASE_URL,
  anon = process.env.TEST_ANON_KEY,
  service = process.env.TEST_SERVICE_KEY;
if (!url || !anon || !service) throw new Error("Set TEST_SUPABASE_URL, TEST_ANON_KEY and TEST_SERVICE_KEY");
const host = new URL(url).hostname;
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const users = [];
let chatId, browser, vite, fileId;
const uploadedPaths = new Set();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 45000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) {
      console.log("PASS: " + label);
      return;
    }
    await pause(250);
  }
  throw new Error("Timed out: " + label);
};
async function user(label) {
  const password = randomBytes(24).toString("hex"),
    email = `nexus-recovery-${Date.now()}-${label}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `Recovery QA ${label}` },
  });
  if (error) throw new Error("Cannot create disposable test user");
  const id = data.user.id;
  users.push(id);
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error("Cannot sign in test user");
  const profile = await client
    .from("profiles")
    .update({ username: "recover_" + randomBytes(5).toString("hex") })
    .eq("id", id);
  if (profile.error) throw new Error("Cannot prepare test profile");
  return { id, client, session: login.data.session };
}
try {
  const a = await user("sender"),
    b = await user("peer");
  const direct = await a.client.rpc("create_direct_chat", { target_user_id: b.id });
  if (direct.error) throw direct.error;
  chatId = direct.data;
  const seed = "Recovery seed " + Date.now();
  const seedResult = await a.client.from("messages").insert({ chat_id: chatId, sender_id: a.id, body: seed });
  if (seedResult.error) throw seedResult.error;
  vite = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4191", "--strictPort"],
    {
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        TEST_SERVICE_KEY: "",
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_PUBLISHABLE_KEY: anon,
        VITE_DEMO_MODE: "false",
        VITE_DEMO_SEED: "false",
      },
    },
  );
  let viteError = "";
  vite.stderr.on("data", (data) => {
    viteError += data.toString();
  });
  await wait(
    async () => {
      try {
        return (await fetch("http://127.0.0.1:4191/my-messenger/")).ok;
      } catch {
        return false;
      }
    },
    "candidate server starts",
    20000,
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(
    (session) => localStorage.setItem("sb-nexus-auth-a", JSON.stringify(session)),
    a.session,
  );
  let failProfile = true,
    blockWrites = false,
    holdReceipt = false,
    lostUpload = false,
    lostInsert = false;
  let insertAttempts = 0;
  await context.route(
    (address) => address.hostname === host,
    async (route) => {
      const request = route.request(),
        address = new URL(request.url()),
        path = address.pathname;
      const unavailable = (status = 503) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ message: "QA temporary outage", statusCode: String(status) }),
        });
      if (failProfile && path === "/rest/v1/profiles" && request.method() === "GET") return unavailable(500);
      if (
        blockWrites &&
        request.method() === "POST" &&
        (path === "/rest/v1/messages" || path.startsWith("/storage/v1/object/chat-media/"))
      )
        return unavailable();
      if (
        holdReceipt &&
        ((path === "/rest/v1/messages" && request.method() === "GET" && address.search.includes(fileId)) ||
          path.includes("/rpc/message_history_") ||
          path.endsWith("/rpc/recover_chat_messages"))
      )
        return unavailable();
      if (request.method() === "POST" && path.startsWith("/storage/v1/object/chat-media/")) {
        uploadedPaths.add(decodeURIComponent(path.slice("/storage/v1/object/chat-media/".length)));
        if (!lostUpload) {
          const response = await route.fetch();
          if (response.ok()) {
            lostUpload = true;
            await route.abort("failed");
            return;
          }
          await route.fulfill({ response });
          return;
        }
      }
      if (request.method() === "POST" && path === "/rest/v1/messages") {
        const payload = request.postDataJSON();
        if (payload.attachment && payload.id === fileId) {
          insertAttempts++;
          if (!lostInsert) {
            const response = await route.fetch();
            if (response.ok()) {
              lostInsert = true;
              holdReceipt = true;
              await route.abort("failed");
              return;
            }
            await route.fulfill({ response });
            return;
          }
        }
      }
      await route.continue();
    },
  );
  let page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4191/my-messenger/", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Повторить загрузку" })).toBeVisible();
  failProfile = false;
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.locator(".chat-list")).toContainText(seed);
  await expect(page.locator(".messages-area")).toContainText(seed);
  console.log("PASS: profile outage recovers without page reload");
  await context.setOffline(true);
  const text = "Queued recovery " + Date.now();
  await page.getByLabel("Текст сообщения").fill(text);
  await page.getByLabel("Отправить сообщение").click();
  await expect(page.locator(".messages-area")).toContainText(text);
  await expect(page.locator(".messages-area")).toContainText("В очереди");
  await expect(page.getByLabel("Текст сообщения")).toHaveValue("");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "qa-recovery.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nNexus durable outbox check\n%%EOF"),
    });
  await expect(page.locator(".upload-retry")).toContainText("qa-recovery.pdf");
  const textId = await page.evaluate((owner) => {
    const name = Object.keys(localStorage).find((key) => key.startsWith(`nexus-outbox:${owner}:`));
    return JSON.parse(localStorage.getItem(name)).uuid;
  }, a.id);
  const savedJobs = await page.evaluate(async (owner) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("nexus-attachment-outbox", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await new Promise((resolve, reject) => {
      const request = db.transaction("jobs").objectStore("jobs").index("owner").getAll(owner);
      request.onsuccess = () =>
        resolve(
          request.result.map((job) => ({
            key: job.key,
            size: job.files[0].blob.size,
            name: job.files[0].name,
          })),
        );
      request.onerror = () => reject(request.error);
    });
  }, a.id);
  expect(savedJobs).toHaveLength(1);
  expect(savedJobs[0].size).toBeGreaterThan(0);
  fileId = savedJobs[0].key;
  console.log("PASS: offline text and file bytes committed to account storage");
  blockWrites = true;
  await context.setOffline(false);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".messages-area")).toContainText(text);
  await expect(page.locator(".upload-retry")).toContainText("qa-recovery.pdf");
  console.log("PASS: reload restores original text UUID and file job");
  blockWrites = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await wait(() => holdReceipt, "simulate successful attachment publication with lost HTTP acknowledgement");
  await wait(
    async () => Boolean((await admin.from("messages").select("id").eq("id", fileId).maybeSingle()).data),
    "server has acknowledged attachment despite missing client receipt",
  );
  await page.close();
  holdReceipt = false;
  page = await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("http://127.0.0.1:4191/my-messenger/", { waitUntil: "networkidle" });
  await expect(page.locator(".messages-area")).toContainText("qa-recovery.pdf");
  await wait(async () => {
    const queue = await page.evaluate(async (owner) => {
      const request = indexedDB.open("nexus-attachment-outbox", 1);
      const db = await new Promise((resolve) => (request.onsuccess = () => resolve(request.result)));
      return await new Promise((resolve) => {
        const read = db.transaction("jobs").objectStore("jobs").index("owner").getAll(owner);
        read.onsuccess = () => resolve(read.result.length);
      });
    }, a.id);
    return queue === 0;
  }, "restart acknowledges published file and clears local job");
  await wait(
    async () => Boolean((await admin.from("messages").select("id").eq("id", textId).maybeSingle()).data),
    "text is eventually acknowledged",
  );
  const rows = await admin.from("messages").select("id").in("id", [textId, fileId]);
  expect(rows.data).toHaveLength(2);
  expect(uploadedPaths.size).toBe(1);
  expect(insertAttempts).toBe(1);
  expect(errors).toEqual([]);
  const storage = await admin.storage.from("chat-media").list(`${chatId}/${a.id}`, { search: fileId });
  expect(storage.data).toHaveLength(1);
  console.log(
    "PASS: one message per UUID and one storage object after lost upload/insert responses and two page lifetimes",
  );
} finally {
  if (browser) await browser.close();
  if (vite) vite.kill();
  for (const path of uploadedPaths)
    if (chatId && users[0] && path.startsWith(`${chatId}/${users[0]}/`))
      await admin.storage.from("chat-media").remove([path]);
  if (chatId) await admin.from("chats").delete().eq("id", chatId);
  for (const id of users) {
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log("Disposable recovery fixtures cleaned");
}
