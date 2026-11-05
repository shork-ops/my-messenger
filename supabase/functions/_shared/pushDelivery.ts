import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
const corsHeaders = { "Access-Control-Allow-Origin": "*" };
type Send = typeof webpush.sendNotification;

async function deliver(admin: SupabaseClient, messageId: string, send: Send): Promise<Response> {
  // Read authoritative content instead of trusting the webhook body.
  const { data: record, error } = await admin.from("messages")
    .select("id, chat_id, sender_id, body, attachment, send_at, deleted_at, expires_at").eq("id", messageId).maybeSingle();
  if (error) return new Response("Message lookup failed", { status: 500, headers: corsHeaders });
  const now = Date.now();
  if (record?.send_at && Date.parse(record.send_at) > now) return new Response("Message rescheduled", { status: 409 });
  if (!record?.sender_id || record.deleted_at ||
      (record.expires_at && Date.parse(record.expires_at) <= now)) return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
  const { data: memberRows, error: membersError } = await admin.from("chat_members").select("user_id, muted_until").eq("chat_id", record.chat_id);
  if (membersError) return new Response("Recipient lookup failed", { status: 500, headers: corsHeaders });
  const recipients = (memberRows ?? [])
    .filter(row => row.user_id !== record.sender_id && (!row.muted_until || Date.parse(row.muted_until) <= now))
    .map(row => row.user_id as string);
  if (recipients.length === 0) {
    return new Response(JSON.stringify({ skipped: true }), { status: 200, headers: corsHeaders });
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@example.com";
  if (!publicKey || !privateKey) {
    return new Response(JSON.stringify({ error: "VAPID keys are not configured" }), { status: 500, headers: corsHeaders });
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const [chatResult, senderResult, subscriptionsResult] = await Promise.all([
    admin.from("chats").select("title, is_group").eq("id", record.chat_id).maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", record.sender_id).maybeSingle(),
    admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", recipients),
  ]);

  if (chatResult.error || senderResult.error || subscriptionsResult.error) return new Response("Push metadata lookup failed", { status: 503 });
  const chat = chatResult.data, sender = senderResult.data, subscriptions = subscriptionsResult.data;
  const { data: receipts, error: receiptError } = await admin.from("push_delivery_receipts").select("subscription_id").eq("message_id", messageId);
  if (receiptError) return new Response("Receipt lookup failed", { status: 503 });
  const delivered = new Set((receipts ?? []).map(row => row.subscription_id));
  const body = record.attachment ? "Вложение" : (record.body || "Новое сообщение").slice(0, 140);
  const title = chat?.is_group ? `${sender?.display_name ?? "Сообщение"} · ${chat.title}` : (sender?.display_name ?? "Nexus");
  const data = JSON.stringify({ title, body, chatId: record.chat_id, messageId: record.id });

  const staleIds: string[] = [];
  let sent = 0;
  let failed = 0;
  await Promise.all(
    (subscriptions ?? []).filter(subscription => !delivered.has(subscription.id)).map(async (subscription) => {
      try {
        await send(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          data, { timeout: 10000 }
        );
        const { error: saveError } = await admin.from("push_delivery_receipts").upsert({ message_id: messageId, subscription_id: subscription.id });
        if (saveError) { failed++; return; }
        sent++;
        await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", subscription.id);
      } catch (error) {
        // 404/410 mean the browser revoked the subscription: drop it, do not retry.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) staleIds.push(subscription.id);
        else failed++;
      }
    })
  );
  if (staleIds.length > 0) {
    const { error } = await admin.from("push_subscriptions").delete().in("id", staleIds);
    if (error) failed++;
  }

  return new Response(JSON.stringify({ sent, failed, removed: staleIds.length }), {
    status: failed ? 503 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function processPush(admin: SupabaseClient, messageId: string, send: Send = webpush.sendNotification.bind(webpush)): Promise<Response> {
  const { data: token, error } = await admin.rpc("claim_message_push", { p_message: messageId });
  if (error) return new Response("Push claim failed", { status: 503 });
  if (!token) return Response.json({ skipped: true });
  let result: Response;
  try { result = await deliver(admin, messageId, send); }
  catch { result = new Response("Push delivery failed", { status: 503 }); }
  const finished = await admin.rpc("finish_message_push", { p_message: messageId, p_token: token, p_success: result.ok });
  if (finished.error || !finished.data) return new Response("Push completion failed", { status: 503 });
  return result;
}
