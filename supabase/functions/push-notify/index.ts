// Supabase Edge Function: sends a Web Push notification when a message is inserted.
//
// Deploy:
//   supabase functions deploy push-notify --no-verify-jwt
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//
// Hook it up with a Database Webhook on `public.messages` (INSERT), or call it from a trigger.
// The function is idempotent: a missing subscription never fails the request.
import { createClient } from "npm:@supabase/supabase-js@2";
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

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@example.com";
  if (!publicKey || !privateKey) {
    return new Response(JSON.stringify({ error: "VAPID keys are not configured" }), { status: 500, headers: corsHeaders });
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const payload = (await request.json()) as WebhookPayload;
  const record = payload.record;
  if (!record?.chat_id || !record.sender_id) {
    return new Response(JSON.stringify({ skipped: true }), { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: memberRows } = await admin.from("chat_members").select("user_id").eq("chat_id", record.chat_id);
  const recipients = (memberRows ?? []).map((row) => row.user_id as string).filter((id) => id !== record.sender_id);
  if (recipients.length === 0) {
    return new Response(JSON.stringify({ skipped: true }), { status: 200, headers: corsHeaders });
  }

  const [{ data: chat }, { data: sender }, { data: subscriptions }] = await Promise.all([
    admin.from("chats").select("title, is_group").eq("id", record.chat_id).maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", record.sender_id).maybeSingle(),
    admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", recipients),
  ]);

  const body = record.attachment ? "Вложение" : (record.body || "Новое сообщение").slice(0, 140);
  const title = chat?.is_group ? `${sender?.display_name ?? "Сообщение"} · ${chat.title}` : (sender?.display_name ?? "Nexus");
  const data = JSON.stringify({ title, body, chatId: record.chat_id, messageId: record.id });

  const staleIds: string[] = [];
  await Promise.all(
    (subscriptions ?? []).map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          data
        );
        await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", subscription.id);
      } catch (error) {
        // 404/410 mean the browser revoked the subscription: drop it, do not retry.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) staleIds.push(subscription.id);
      }
    })
  );
  if (staleIds.length > 0) await admin.from("push_subscriptions").delete().in("id", staleIds);

  return new Response(JSON.stringify({ sent: (subscriptions?.length ?? 0) - staleIds.length, removed: staleIds.length }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
