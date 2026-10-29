// Edge Function: mints an SFU access token for a call.
//
// The provider is chosen by configuration, not by code changes:
//   CALL_PROVIDER=livekit  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
//   CALL_PROVIDER=none     (default) returns 503 with a clear message
//
// Only a member of the call's chat may receive a token, and only while the call
// is ringing or active. The token is scoped to the call's room and to the
// caller's own identity, so it cannot be reused for another call.
//
// Cloudflare Calls is the documented alternative but was not wired: choosing it
// is a different token shape (its own endpoint creates a session), so pretending
// to support it behind the same code path would be untested dead weight.

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

/** Base64url, no padding, which is what LiveKit expects for its JWTs. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Builds a LiveKit access token (JWT, HS256).
 *
 * Written out rather than pulled from the SDK: the npm package is large, and the
 * token is a standard JWT, so the signing is a few dozen lines that can be
 * reasoned about — and it avoids another dependency in a cold-start path.
 */
async function signLiveKitToken(options: {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  name: string;
  canPublish: boolean;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: options.apiKey,
    sub: options.identity,
    name: options.name,
    nbf: now - 10,
    exp: now + 60 * 60,
    // `video` grants must be nested exactly as LiveKit defines them.
    video: {
      room: options.room,
      roomJoin: true,
      canPublish: options.canPublish,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  const unsigned = `${encodeJson(header)}.${encodeJson(payload)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

type CallRow = {
  id: string;
  chat_id: string;
  created_by: string;
  status: string;
  room_name: string;
  kind: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return json({ error: "Function is missing Supabase configuration" }, 500);
  }

  // Identity always comes from the caller's own JWT, never from the body.
  const authorization = request.headers.get("Authorization") ?? "";
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Authentication required" }, 401);

  let body: { callId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.callId) return json({ error: "callId is required" }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: call, error: callError } = await admin
    .from("calls")
    .select("id, chat_id, created_by, status, room_name, kind")
    .eq("id", body.callId)
    .maybeSingle<CallRow>();
  if (callError) return json({ error: callError.message }, 500);
  if (!call) return json({ error: "Call not found" }, 404);

  const { data: membership } = await admin
    .from("chat_members")
    .select("user_id")
    .eq("chat_id", call.chat_id)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!membership) return json({ error: "Not a member of this chat" }, 403);

  if (call.status !== "ringing" && call.status !== "active") {
    return json({ error: "Call is already finished" }, 409);
  }

  const provider = (Deno.env.get("CALL_PROVIDER") ?? "none").toLowerCase();
  if (provider === "none") {
    return json(
      {
        error: "Calling is not configured",
        detail: "Set CALL_PROVIDER and the provider credentials to enable calls.",
      },
      503
    );
  }

  if (provider !== "livekit") {
    return json({ error: `Unsupported CALL_PROVIDER: ${provider}` }, 500);
  }

  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!livekitUrl || !apiKey || !apiSecret) {
    return json({ error: "LiveKit credentials are not configured" }, 500);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", userData.user.id)
    .maybeSingle();

  const token = await signLiveKitToken({
    apiKey,
    apiSecret,
    room: call.room_name,
    identity: userData.user.id,
    name: profile?.display_name ?? "Nexus user",
    canPublish: true,
  });

  return json({
    provider: "livekit",
    url: livekitUrl,
    token,
    room: call.room_name,
    kind: call.kind,
  });
});
