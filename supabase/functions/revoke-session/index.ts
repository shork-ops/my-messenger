// Ends sign-ins for real, using Supabase Auth's own session store.
//
// Why this function exists at all: GoTrue (Supabase Auth) decides whether a refresh token is still
// honoured by looking only at its own `sessions` and `refresh_tokens` tables. A flag in an
// application table - which is what `public.device_sessions.revoked_at` is - is never consulted
// when a client asks for a new access token. So "revoke this device" written as an UPDATE on our own
// row is a diary entry, not an order. The only thing that actually stops a refresh is revoking the
// session in the auth server, and that needs the service role key, which must never reach a
// browser. Hence: this function, and nothing else, holds the power to revoke.
//
// What GoTrue actually offers, checked against the supabase/auth source rather than assumed:
//
//   * `POST /auth/v1/logout?scope=local|others|global` (internal/api/logout.go -> models.Logout,
//     LogoutSession, LogoutAllExceptMe). "local" revokes the caller's own session, "others" revokes
//     the user's other sessions, "global" revokes all. These set `refresh_tokens.revoked` and/or
//     `sessions.not_after`, which is what the refresh grant checks.
//   * There is NO per-session admin endpoint. supabase-js 2.118 exposes only
//     `admin.signOut(jwt, scope)`. `listUserSessions` and `deleteUserSession` do not exist in this
//     version - code built on them fails at runtime, so none is used here.
//
// Consequences for the product, stated plainly because they shape the screen:
//
//   * "Sign out this device" is the caller ending their own session: `scope=local`.
//   * "Sign out other devices" is `scope=others`.
//   * Revoking one arbitrary *other* device is not offered by the API. The list is still useful - it
//     shows what is signed in and when each was last seen - and the honest bulk action is "all
//     others".
//
// Authorization, in order:
//   1. The caller must present a valid JWT. Identity comes from that JWT (`getUser()`), never from
//      the request body - a body-supplied user id is the classic way this becomes a vulnerability.
//   2. Only the caller's own account is ever acted on. There is no parameter for a user id.
//   3. The response states what was done and what it means, including the residual life of an
//      already-issued access token, so no screen has to guess.

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

/**
 * How long an access token handed out before revocation keeps working.
 *
 * Not a guess about our code: a JWT is honoured on signature and expiry. Nothing in the request path
 * asks a table whether the session is still wanted, so a token issued one second before revocation
 * works for the rest of its lifetime. Supabase's default is 3600 seconds. Report it so the screen can
 * say "within the hour" instead of "instantly", which the server would not honour.
 */
const ACCESS_TOKEN_LIFETIME_SECONDS = 3600;

type Scope = "local" | "others" | "global";

const SCOPES: readonly Scope[] = ["local", "others", "global"];

/** Reads the `session_id` claim out of a token the auth server has already verified. */
function sessionIdFromToken(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof decoded.session_id === "string" && decoded.session_id.length > 0
      ? decoded.session_id
      : null;
  } catch {
    return null;
  }
}

function guarantee() {
  return { refreshRevoked: true, accessTokenLifetimeSeconds: ACCESS_TOKEN_LIFETIME_SECONDS };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    // Not a user error and must not look like one: the screen shows "unavailable", never "revoked".
    return json({ error: "misconfigured", detail: "Supabase credentials are missing" }, 500);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Authentication required" }, 401);
  }
  const accessToken = authorization.slice(7).trim();

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  // Identity from the verified JWT: `getUser()` has the auth server validate the token, so a forged
  // or expired token does not get past this line, and there is nothing in the body to trust.
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Authentication required" }, 401);
  }
  const callerId = userData.user.id;

  let rawScope: unknown = "local";
  try {
    const body = (await request.json()) as { scope?: unknown } | null;
    if (body && body.scope !== undefined) rawScope = body.scope;
  } catch {
    // An empty body means the default scope. Not an error.
  }
  if (typeof rawScope !== "string" || !SCOPES.includes(rawScope as Scope)) {
    return json({ error: "Unknown scope" }, 400);
  }
  const scope = rawScope as Scope;

  // Revoke through the auth server with the service key, so it applies to the account rather than to
  // whichever token happens to be presented.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.signOut(accessToken, scope);
  if (error) {
    return json({ error: "revoke-failed", detail: error.message }, 502);
  }

  // Mirror the outcome into our own table so the list agrees with the auth server. This reports what
  // the auth server did; the row is not what enforces anything, and deleting it would lose the audit
  // trail.
  const now = new Date().toISOString();
  const callerSessionId = sessionIdFromToken(accessToken);
  let mirror = admin
    .from("device_sessions")
    .update({ revoked_at: now, revoked_reason: scope === "global" ? "signout" : "user" })
    .eq("user_id", callerId)
    .is("revoked_at", null);

  if (scope === "local") {
    if (callerSessionId === null) {
      // Without the claim we cannot tell which row is the caller's, and guessing would mark the wrong
      // phone as ended. The auth revocation already happened; the list is corrected by the next
      // registration instead.
      return json({ revoked: scope, guarantee: guarantee(), warning: "list-not-updated" });
    }
    mirror = mirror.eq("auth_session_id", callerSessionId);
  }

  const { error: mirrorError } = await mirror;
  if (mirrorError) {
    // Revocation already succeeded; failing the request would be a lie in the other direction.
    return json({
      revoked: scope,
      guarantee: guarantee(),
      warning: "list-stale",
      detail: mirrorError.message,
    });
  }

  return json({ revoked: scope, self: scope !== "others", guarantee: guarantee() });
});
