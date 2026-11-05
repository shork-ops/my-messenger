// Supabase Edge Function: sends a Web Push notification when a message is inserted.
//
// Deploy:
//   supabase functions deploy push-notify --no-verify-jwt
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//
// Hook it up with a Database Webhook on `public.messages` (INSERT), or call it from a trigger.
// Webhook and scheduled worker share a durable lease and per-subscription receipts.
import { createClient } from "npm:@supabase/supabase-js@2";
import { maintenanceAuthorized } from "../_shared/maintenanceAuth.ts";
import { processPush } from "../_shared/pushDelivery.ts";

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

  return await processPush(admin, payload.record.id);
});
