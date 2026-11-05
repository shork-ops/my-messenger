import { createClient } from "npm:@supabase/supabase-js@2";
import { maintenanceAuthorized } from "../_shared/maintenanceAuth.ts";
import { processPush } from "../_shared/pushDelivery.ts";

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!await maintenanceAuthorized(request.headers.get("Authorization"), Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const now = new Date().toISOString();
  const { data: jobs, error } = await admin.from("push_jobs").select("message_id")
    .is("completed_at", null).lte("available_at", now)
    .or(`lease_until.is.null,lease_until.lte.${now}`).order("available_at").limit(10);
  if (error) return new Response("Queue lookup failed", { status: 503 });
  // Each job atomically claims its lease. Concurrent cron/webhook calls cannot own it together.
  let failed = 0;
  await Promise.all((jobs ?? []).map(async job => {
    try { if (!(await processPush(admin, job.message_id)).ok) failed++; }
    catch { failed++; }
  }));
  return Response.json({ processed: jobs?.length ?? 0, failed }, { status: failed ? 503 : 200 });
});
