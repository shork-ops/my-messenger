/**
 * The list of places this account is signed in.
 *
 * This replaces a device list the browser used to invent for itself. That list could only ever
 * describe the browser it was written in: it recorded devices that had opened the app in *this*
 * profile, kept them after they signed out, and could not see a phone at all. The button beside it
 * then deleted rows from that local list, which looked like revocation and revoked nothing. Real
 * sessions have to come from the server, because the server is where a session can actually be
 * ended.
 *
 * Two identifiers matter here and they are not the same thing:
 *
 * - `clientId` names this browser profile. It is random and stored locally, and it is how the list
 *   knows which row is "this device". It is not a fingerprint and carries nothing identifiable.
 * - `sessionId` names a row on the server. Every action below sends one of these, and the server
 *   decides whether the caller is allowed to touch it — the client never gets to say.
 *
 * The honest limit, spelled out in `deviceSessionsDoc`, is that an access token already handed out
 * keeps working until it expires. See docs/DEVICE_SESSIONS.md.
 */

import { supabase } from "./supabase";
import { describeDevice } from "./sessions";
import { readItem, writeItem } from "./safeStorage";

/**
 * Where this browser keeps its own client id.
 *
 * Stored under a plain key, not in an account's namespace, because it names the *device*: two
 * accounts used in one browser profile are two sessions on the same device, and they must agree
 * about which device that is. It carries nothing identifiable - it is a random id.
 */
const CLIENT_ID_KEY = "nexus-device-id";

/** One active session, as the server returns it. */
export type DeviceSession = {
  id: string;
  clientId: string;
  label: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
};

/** What went wrong, in terms a screen can use without parsing messages. */
export type SessionError = "offline" | "not-deployed" | "refused";

export type SessionListResult =
  | { ok: true; sessions: DeviceSession[] }
  | { ok: false; error: SessionError };

/**
 * This browser profile's client id, created on first use.
 *
 * Kept in local storage rather than derived from the user agent: two identical laptops must be two
 * sessions, and a browser that clears its storage is simply a new one, which is the honest answer.
 */
export function localClientId(): string {
  const existing = readItem(CLIENT_ID_KEY);
  if (existing && existing.length >= 8) return existing;
  const created = randomId();
  writeItem(CLIENT_ID_KEY, created);
  return created;
}

/**
 * A random identifier.
 *
 * `crypto.randomUUID` when the browser has it, because it is the one that is actually random; the
 * fallback is only for very old webviews, and it is still long enough to not collide between two
 * devices belonging to one person.
 */
export function randomId(): string {
  const cryptoLike = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoLike && typeof cryptoLike.randomUUID === "function") return cryptoLike.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoLike && typeof cryptoLike.getRandomValues === "function") cryptoLike.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** How this device describes itself, for the label in the list. */
export function describeThisDevice(): { label: string; platform: string } {
  if (typeof navigator === "undefined") return { label: "Браузер", platform: "Неизвестно" };
  return describeDevice(navigator.userAgent);
}

/**
 * The Supabase auth session id this browser is holding.
 *
 * Read from the access token's `session_id` claim. That claim is signed by the auth server, so it is
 * the one honest answer to "which server-side session am I?" - and the server reads the same claim
 * out of the same token rather than trusting anything we send beside it.
 *
 * This used to be a stub that always returned `null`, which quietly turned every server-side session
 * binding into dead code. It is written out properly now, and a null is returned as null rather than
 * papered over: a row with no session id simply cannot be matched to an auth session.
 */
async function authSessionId(): Promise<string | null> {
  const client = supabase;
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof claims.session_id === "string" && claims.session_id.length > 0
      ? claims.session_id
      : null;
  } catch {
    return null;
  }
}

/** Exposed so a test can exercise the reader the registration path actually uses. */
export const readAuthSessionId = authSessionId;

/** Translates a Postgres/PostgREST failure into something a screen can act on. */
function classify(error: { code?: string; message?: string } | null): SessionError {
  const message = (error?.message ?? "").toLowerCase();
  // A missing function means the migration has not been applied to this project yet. That is a
  // deployment fact, not a user error, and the screen must not pretend the feature is working.
  if (error?.code === "42883" || message.includes("does not exist") || message.includes("could not find the function")) {
    return "not-deployed";
  }
  if (message.includes("permission denied") || error?.code === "42501" || error?.code === "28000") return "refused";
  return "offline";
}

/**
 * Tells the server this browser is signed in.
 *
 * Idempotent: calling it on every app start is the intended use, and the server updates one row
 * rather than adding one per launch.
 */
export async function registerDeviceSession(): Promise<boolean> {
  const client = supabase;
  if (!client) return false;
  const clientId = localClientId();
  const { label, platform } = describeThisDevice();
  const { error } = await client.rpc("device_register_session", {
    p_client_id: clientId,
    p_device_label: label,
    p_platform: platform,
    p_auth_session_id: await authSessionId(),
  });
  return !error;
}

/** This account's active sessions, newest activity first. */
export async function listDeviceSessions(): Promise<SessionListResult> {
  const client = supabase;
  if (!client) return { ok: false, error: "offline" };
  const { data, error } = await client.rpc("device_list_sessions", {
    p_current_client_id: localClientId(),
  });
  if (error) return { ok: false, error: classify(error) };

  const rows = (data ?? []) as {
    id: string;
    client_id: string;
    device_label: string | null;
    platform: string | null;
    created_at: string;
    last_seen_at: string;
    is_current: boolean | null;
  }[];

  return {
    ok: true,
    sessions: rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      label: row.device_label?.trim() || "Неизвестное устройство",
      platform: row.platform?.trim() || "Неизвестно",
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      isCurrent: Boolean(row.is_current),
    })),
  };
}

/**
 * Calls the `revoke-session` Edge Function.
 *
 * That function holds the service role key, so it is the only place that can actually end a session
 * in Supabase Auth. It answers a narrow vocabulary on purpose; anything unrecognised is reported as
 * a failure rather than as success, because a screen that invents a successful sign-out is worse than
 * one that admits it could not sign out.
 */
async function callRevoke(
  scope: "local" | "others" | "global"
): Promise<{ ok: true; warning?: string } | { ok: false; error: SessionError }> {
  const client = supabase;
  if (!client) return { ok: false, error: "offline" };

  const { data, error } = await client.functions.invoke("revoke-session", { body: { scope } });
  if (error) {
    // A function that is not deployed answers 404. Distinguish it from an outage so the screen can
    // say "not set up yet" instead of "try again".
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 404) return { ok: false, error: "not-deployed" };
    return { ok: false, error: classify({ message: error.message }) };
  }

  const body = data as { revoked?: unknown; warning?: unknown; error?: unknown } | null;
  if (!body || body.revoked !== scope) {
    if (body && body.error === "misconfigured") return { ok: false, error: "not-deployed" };
    return { ok: false, error: "refused" };
  }
  return { ok: true, warning: typeof body.warning === "string" ? body.warning : undefined };
}

/**
 * Ends this device's own session for real.
 *
 * "Real" means Supabase Auth stops honouring its refresh token - see the Edge Function for why that
 * is the only thing that counts. The person is signing out of the page they are using, so the caller
 * is expected to end the client session afterwards too.
 */
export async function revokeThisDeviceSession(): Promise<{ ok: true } | { ok: false; error: SessionError }> {
  const result = await callRevoke("local");
  return result.ok ? { ok: true } : result;
}

/**
 * Ends every other session of this account, for real.
 *
 * There is deliberately no "end that one other device" here. Supabase's admin API in supabase-js
 * 2.118 offers `signOut(jwt, scope)` and nothing per-session, so a per-device button would be a
 * promise the server cannot keep. The list shows what is signed in; the action is "all others".
 */
export async function revokeOtherDeviceSessions(): Promise<{ ok: true } | { ok: false; error: SessionError }> {
  const result = await callRevoke("others");
  return result.ok ? { ok: true } : result;
}

/**
 * What this feature does and does not promise.
 *
 * Written as data rather than only as prose, because the screen shows these and a test can check that
 * it really does. The previous wording claimed revocation took effect at once while nothing enforced
 * it; these sentences describe what the Edge Function actually does.
 */
export const DEVICE_SESSIONS_LIMITS = [
  "Выход завершает сессию в самом Supabase Auth: токен обновления этой сессии больше не будет принят.",
  "Уже выданный токен доступа доживает свой срок — обычно до часа. Доступ обрывается не в момент нажатия, и мы этого не обещаем.",
  "Завершить одну произвольную чужую сессию нельзя: API Supabase такой операции не даёт. Можно завершить эту сессию или все остальные.",
] as const;
