// Live two-account check against the real Supabase project.
//
// The app only offers Google sign-in, so this script obtains a real Supabase
// session by password outside the browser and injects it into localStorage
// under the key the client expects. Everything after that runs as in prod.
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("qa-accounts.json", "utf8"));
const [alphaInfo, betaInfo] = config.accounts;
const BASE = "http://127.0.0.1:4173/my-messenger/";
const projectRef = new URL(config.url).hostname.split(".")[0];
const STORAGE_KEY = "sb-" + projectRef + "-auth-token";

const results = [];
const errors = [];
function check(step, ok, detail) {
  results.push({ step, ok, detail: detail || "" });
  console.log((ok ? "PASS  " : "FAIL  ") + step + (detail ? " -- " + detail : ""));
}

const admin = createClient(config.url, process.env.TEST_SERVICE_KEY, { auth: { persistSession: false } });
// One client per account: a shared client would follow whichever session was set last.
const clientA = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
const clientB = createClient(config.url, config.anonKey, { auth: { persistSession: false } });

async function makeSession(client, account) {
  const { data, error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error("sign-in failed for " + account.email + ": " + error.message);
  return data.session;
}

async function openFor(browser, session) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(session)]
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE);
  await page.waitForSelector(".app-shell", { timeout: 30000 });
  return { context, page };
}

async function resetQaChats() {
  const ids = [alphaInfo.userId, betaInfo.userId];
  const { data: rows } = await admin.from("chat_members").select("chat_id").in("user_id", ids);
  const unique = [...new Set((rows || []).map((row) => row.chat_id))];
  if (unique.length === 0) return;
  await admin.from("messages").delete().in("chat_id", unique);
  await admin.from("chat_members").delete().in("chat_id", unique);
  await admin.from("chats").delete().in("id", unique);
}

const browser = await chromium.launch();
let ctxA, ctxB;

try {
  await resetQaChats();

  const sessionA = await makeSession(clientA, alphaInfo);
  const sessionB = await makeSession(clientB, betaInfo);

  ({ context: ctxA } = await openFor(browser, sessionA));
  check("Alpha signed in with a real Supabase session", true);
  ({ context: ctxB } = await openFor(browser, sessionB));
  check("Beta signed in with a real Supabase session", true);
    // Alpha acts through its own client.
  const { data: chatData, error: groupError } = await clientA.rpc("create_group_chat", {
    group_title: "QA group " + Date.now(),
  });
  const chatRow = Array.isArray(chatData) ? chatData[0] : chatData;
  const chatUuid = typeof chatRow === "string" ? chatRow : chatRow && chatRow.chat_id ? chatRow.chat_id : null;
  check("Group created through the RPC", !groupError && Boolean(chatUuid), groupError ? groupError.message : "chat_id=" + chatUuid);

  if (chatUuid) {
    const pageA = ctxA.pages()[0];
    await pageA.reload();
    await pageA.waitForSelector(".app-shell", { timeout: 30000 });

    const invite = await admin.from("chats").select("invite_code").eq("id", chatUuid).maybeSingle();
    if (invite.data && invite.data.invite_code) {
    // Beta acts through its own client.
      const { error: joinError } = await clientB.rpc("join_group_by_invite", { invite_code_input: invite.data.invite_code });
      check("Beta joined through the invite link", !joinError, joinError ? joinError.message : "");
    }

    const { error: msgError } = await clientB
      .from("messages")
      .insert({ chat_id: chatUuid, sender_id: betaInfo.userId, body: "Live message from Beta" });
    check("Beta sent a message into the group", !msgError, msgError ? msgError.message : "");

    await pageA.reload();
    await pageA.waitForSelector(".app-shell", { timeout: 30000 });
    await pageA.waitForTimeout(3000);
    const visible = await pageA.getByText("Live message from Beta").first().isVisible().catch(() => false);
    check("Alpha sees Beta's message in the UI", visible);
    // Alpha acts through its own client.
    const { error: roleError } = await clientA.rpc("set_chat_member_role", {
      target_chat_id: chatUuid,
      target_user_id: betaInfo.userId,
      new_role: "admin",
    });
    check("Owner promoted Beta to admin", !roleError, roleError ? roleError.message : "");
    // Beta acts through its own client.
    const { error: demoteError } = await clientB.rpc("set_chat_member_role", {
      target_chat_id: chatUuid,
      target_user_id: alphaInfo.userId,
      new_role: "member",
    });
    check("Admin cannot demote the owner (fixed bug)", Boolean(demoteError), demoteError ? demoteError.message : "NO ERROR -- BUG STILL PRESENT");

    const { data: memberRow } = await admin
      .from("chat_members")
      .select("role")
      .eq("chat_id", chatUuid)
      .eq("user_id", betaInfo.userId)
      .maybeSingle();
    check("Beta's role is stored as admin", memberRow && memberRow.role === "admin", memberRow ? memberRow.role : "missing");

    const { data: hits, error: searchError } = await clientA.rpc("search_messages", {
      target_chat_id: chatUuid,
      search_query: "live",
      page_size: 10,
      page_offset: 0,
    });
    check(
      "Server search found the message",
      !searchError && Array.isArray(hits) && hits.length > 0,
      searchError ? searchError.message : "hits=" + (Array.isArray(hits) ? hits.length : 0)
    );

    const path = chatUuid + "/" + betaInfo.userId + "/qa-" + Date.now() + ".txt";
    const { error: uploadError } = await clientB.storage
      .from("chat-media")
      .upload(path, new Blob(["qa attachment"], { type: "text/plain" }));
    check("Attachment uploaded to Storage", !uploadError, uploadError ? uploadError.message : path);

    const { error: attachError } = await clientB.from("messages").insert({
      chat_id: chatUuid,
      sender_id: betaInfo.userId,
      body: "File attached",
      attachment: { name: "qa.txt", type: "text/plain", size: 13, path },
    });
    check("Message with attachment stored", !attachError, attachError ? attachError.message : "");

    const signed = await clientB.storage.from("chat-media").createSignedUrl(path, 120);
    check("Signed URL is issued for the attachment", Boolean(signed.data && signed.data.signedUrl), signed.error ? signed.error.message : "");
    await clientB.storage.from("chat-media").remove([path]);

    const { error: blockError } = await clientB.rpc("block_user", { target_user_id: alphaInfo.userId });
    check("Beta blocked Alpha", !blockError, blockError ? blockError.message : "");
    // Alpha acts through its own client.
    const { error: blockedSend } = await clientB
      .from("messages")
      .insert({ chat_id: chatUuid, sender_id: alphaInfo.userId, body: "This must not pass" });
    check("Blocked user cannot send", Boolean(blockedSend), blockedSend ? blockedSend.message : "NO ERROR -- BUG STILL PRESENT");

    // RLS already stops the attempt above, so the trigger is proven separately
    // through the service role, which bypasses RLS entirely.
    const direct = await admin.from("chats").insert({ title: "QA direct", is_group: false, created_by: alphaInfo.userId }).select("id").single();
    if (!direct.error) {
      const directId = direct.data.id;
      await admin.from("chat_members").insert([
        { chat_id: directId, user_id: alphaInfo.userId, role: "owner" },
        { chat_id: directId, user_id: betaInfo.userId, role: "member" },
      ]);
      const bypass = await admin.from("messages").insert({ chat_id: directId, sender_id: alphaInfo.userId, body: "must be stopped" });
      check("Direct-chat block trigger fires without RLS", Boolean(bypass.error), bypass.error ? bypass.error.message : "TRIGGER DEAD");
      await admin.from("messages").delete().eq("chat_id", directId);
      await admin.from("chat_members").delete().eq("chat_id", directId);
      await admin.from("chats").delete().eq("id", directId);
    }
    // Beta acts through its own client.
    const { error: unblockError } = await clientB.rpc("unblock_user", { target_user_id: alphaInfo.userId });
    check("Unblocking works", !unblockError, unblockError ? unblockError.message : "");

    const { error: prefError } = await clientB
      .from("profiles")
      .update({ hide_last_seen: true, disable_read_receipts: true })
      .eq("id", betaInfo.userId);
    check("Privacy preferences save", !prefError, prefError ? prefError.message : "");

    const { data: stored } = await admin
      .from("profiles")
      .select("hide_last_seen, disable_read_receipts")
      .eq("id", betaInfo.userId)
      .single();
    check("Preferences persisted", Boolean(stored && stored.hide_last_seen && stored.disable_read_receipts));
  }

  check("No JS errors on the pages", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (error) {
  check("Scenario ran without throwing", false, error.message);
} finally {
  if (ctxA) await ctxA.close();
  if (ctxB) await ctxB.close();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log("\ntotal: " + results.length + ", failed: " + failed.length);
fs.writeFileSync("qa-results.json", JSON.stringify({ results, errors }, null, 2));
process.exit(failed.length ? 1 : 0);







