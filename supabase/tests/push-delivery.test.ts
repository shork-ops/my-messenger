import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import { processPush } from "../functions/_shared/pushDelivery.ts";

Deno.test("retry sends only failed subscriptions; completed webhook cannot replay", async () => {
  const keys = webpush.generateVAPIDKeys();
  Deno.env.set("VAPID_PUBLIC_KEY", keys.publicKey);
  Deno.env.set("VAPID_PRIVATE_KEY", keys.privateKey);
  let leased = false, done = false;
  const receipts = new Set<string>();
  const attempts: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://test.invalid/")) throw new Error("Live HTTP forbidden");
    const method = input instanceof Request ? input.method : init?.method ?? "GET";
    const raw = input instanceof Request ? await input.text() : String(init?.body ?? "");
    const body = raw ? JSON.parse(raw) : {};
    if (url.includes("/rpc/claim_message_push")) {
      if (leased || done) return Response.json(null);
      leased = true; return Response.json("token");
    }
    if (url.includes("/rpc/finish_message_push")) {
      done = body.p_success; leased = false; return Response.json(true);
    }
    if (url.includes("/messages?")) return Response.json({ id:"message",chat_id:"chat",sender_id:"sender",body:"hello" });
    if (url.includes("/chat_members?")) return Response.json([{user_id:"receiver",muted_until:null}]);
    if (url.includes("/chats?")) return Response.json({ title:"chat",is_group:false });
    if (url.includes("/profiles?")) return Response.json({ display_name:"sender" });
    if (url.includes("/rpc/active_push_subscriptions") || url.includes("/push_subscriptions?")) {
      if (method === "PATCH") return new Response(null, { status: 204 });
      return Response.json(["one","two"].map(id=>({ id,endpoint:id,p256dh:"key",auth:"auth" })));
    }
    if (url.includes("/push_delivery_receipts")) {
      if (method === "POST") { receipts.add(body.subscription_id); return new Response(null, { status: 201 }); }
      return Response.json([...receipts].map(subscription_id=>({subscription_id})));
    }
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  const admin = createClient("https://test.invalid", "test-key", {auth:{persistSession:false}});
  let fail = true;
  const send = ((subscription: { endpoint: string }) => {
    attempts.push(subscription.endpoint);
    if (subscription.endpoint === "two" && fail) return Promise.reject(new Error("temporary outage"));
    return Promise.resolve({statusCode:201,body:"",headers:{}});
  }) as typeof webpush.sendNotification;
  const first = await processPush(admin,"message",send);
  if (first.status !== 503 || done || !receipts.has("one")) throw new Error(`Failure not retained for retry: ${first.status} ${await first.text()} receipts=${[...receipts]} attempts=${attempts}`);
  fail = false;
  if (!(await processPush(admin,"message",send)).ok || !done) throw new Error("Retry did not finish");
  const replay = await processPush(admin,"message",send);
  if (!(await replay.json()).skipped || attempts.join(",") !== "one,two,two") throw new Error(`Duplicate delivery: ${attempts}`);
});
