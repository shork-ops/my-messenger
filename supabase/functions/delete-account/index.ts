// Removes the calling user's auth record after `delete_my_account` cleared the
// app data.
//
// Splitting it this way keeps the service role key out of the browser: the RPC
// the client calls can only touch rows it owns, while deleting from auth.users
// needs elevated rights that are only reachable from this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return json({ error: "Function is missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  // Identity comes from the caller's own JWT, never from the request body.
  const authorization = request.headers.get("Authorization") ?? "";
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Authentication required" }, 401);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Refuse to orphan data: the RPC must have run first.
  const { error: profileError } = await admin.from("profiles").select("id").eq("id", userData.user.id).maybeSingle();
  if (profileError) {
    return json({ error: profileError.message }, 500);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id);
  if (deleteError) {
    return json({ error: deleteError.message }, 500);
  }

  return json({ deleted: true });
});
