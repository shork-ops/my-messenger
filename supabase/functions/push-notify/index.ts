// Supabase Edge Function: sends a Web Push notification when a message is inserted.
//
// Deploy:
//   supabase functions deploy push-notify --no-verify-jwt
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//
// Hook it up with a Database Webhook on `public.messages` (INSERT), or call it from a trigger.
// Missing subscriptions are skipped. Webhook retries may still duplicate a notification.
import { createClient } from "npm:@supabase/supabase-js@2";
import { maintenanceAuthorized } from "../_shared/maintenanceAuth.ts";
import webpush from "npm:web-push@3";

type WebhookPayload = {
  type?: string;
  table?: string;
  record?: { id?: string; chat_id?: string; sender_id?: string; body?: string; attachment?: unknown };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  if (!await maintenanceAuthorized(request.headers.get("Authorization"), Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "")) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }
  const payload = await request.json().catch(() => null) as WebhookPayload | null;
  if (payload?.type !== "INSERT" || payload.table !== "messages" || !payload.record?.id) {
    return new Response("Invalid webhook", { status: 400, headers: corsHeaders });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Read authoritative content instead of trusting the webhook body.
  const { data: record, error } = await admin.from("messages")
    .select("id, chat_id, sender_id, body, attachment, send_at, deleted_at, expires_at").eq("id", payload.record.id).maybeSingle();
  if (error) return new Response("Message lookup failed", { status: 500, headers: corsHeaders });
  const now = Date.now();
  if (!record?.sender_id || record.deleted_at ||
      (record.send_at && Date.parse(record.send_at) > now) ||
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

  const [{ data: chat }, { data: sender }, { data: subscriptions }] = await Promise.all([
    admin.from("chats").select("title, is_group").eq("id", record.chat_id).maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", record.sender_id).maybeSingle(),
    admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", recipients),
  ]);

  const body = record.attachment ? "Вложение" : (record.body || "Новое сообщение").slice(0, 140);
  const title = chat?.is_group ? `${sender?.display_name ?? "Сообщение"} · ${chat.title}` : (sender?.display_name ?? "Nexus");
  const data = JSON.stringify({ title, body, chatId: record.chat_id, messageId: record.id });

  const staleIds: string[] = [];
  let sent = 0;
  await Promise.all(
    (subscriptions ?? []).map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          data
        );
        sent++;
        await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", subscription.id);
      } catch (error) {
        // 404/410 mean the browser revoked the subscription: drop it, do not retry.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) staleIds.push(subscription.id);
      }
    })
  );
  if (staleIds.length > 0) await admin.from("push_subscriptions").delete().in("id", staleIds);

  return new Response(JSON.stringify({ sent, removed: staleIds.length }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
