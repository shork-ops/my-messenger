/**
 * The session list, as the client sees it.
 *
 * The interesting cases are not "the list loads". They are the ones where the screen must not
 * invent an answer: a project without the migration, a refused request, and a signed-out browser
 * that must not be left holding the previous account's list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
});

// `describeDevice` reads the real navigator, so the user agent is set there rather than on the
// stubbed window; jsdom-less node has one but not with the string this test needs.
vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" });

const rpc = vi.fn();
const invoke = vi.fn();
// The access token the auth server would have issued. Its middle part is a base64url JSON payload
// with a `session_id` claim, which is the only thing the client is allowed to read for identity.
const sessionClaims = (sessionId: string) =>
  ["header", Buffer.from(JSON.stringify({ sub: "u", session_id: sessionId })).toString("base64url"), "sig"].join(
    "."
  );
let currentToken: string | null = null;

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    auth: {
      getSession: async () => ({ data: { session: currentToken ? { access_token: currentToken } : null } }),
    },
  },
}));

const {
  describeThisDevice,
  listDeviceSessions,
  localClientId,
  readAuthSessionId,
  revokeThisDeviceSession,
  revokeOtherDeviceSessions,
} = await import("./deviceSessions");

beforeEach(() => {
  storage.clear();
  rpc.mockReset();
  invoke.mockReset();
  currentToken = null;
});

afterEach(() => storage.clear());

describe("localClientId", () => {
  it("creates an id once and reuses it", () => {
    const first = localClientId();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(localClientId()).toBe(first);
  });

  it("is not scoped by account: it names the device, not the person", () => {
    // Two accounts in one browser profile are two sessions on one device, and they must agree
    // about which device that is.
    const first = localClientId();
    storage.set("nexus-scoped:guest:nexus-device-id", "guest-device");
    expect(localClientId()).toBe(first);
  });
});

describe("describeThisDevice", () => {
  it("names the browser and platform in the same vocabulary as the rest of the app", () => {
    expect(describeThisDevice()).toEqual({ label: "Chrome", platform: "Windows" });
  });
});

describe("listDeviceSessions", () => {
  it("maps the server's row shape onto the screen's", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "s1",
          client_id: "client-a",
          device_label: "Chrome",
          platform: "Windows",
          created_at: "2026-10-01T10:00:00Z",
          last_seen_at: "2026-10-31T10:00:00Z",
          is_current: true,
        },
      ],
      error: null,
    });

    const result = await listDeviceSessions();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].label).toBe("Chrome");
    expect(result.sessions[0].isCurrent).toBe(true);
  });

  it("sends this browser's client id, so the server can mark the current row", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    localClientId();
    await listDeviceSessions();
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("device_list_sessions");
    expect(args.p_current_client_id).toHaveLength(36);
  });

  it("reports a missing function as not-deployed rather than as an empty list", async () => {
    // This is the case that matters: an empty list would read as "no other devices", which is a
    // claim about the account. The truth is a claim about the build.
    rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "function does not exist" } });
    const result = await listDeviceSessions();
    expect(result).toEqual({ ok: false, error: "not-deployed" });
  });

  it("reports a refusal as refused", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for function" } });
    const result = await listDeviceSessions();
    expect(result).toEqual({ ok: false, error: "refused" });
  });

  it("falls back to a null label rather than rendering an empty string", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "s1",
          client_id: "client-a",
          device_label: "   ",
          platform: null,
          created_at: "2026-10-01T10:00:00Z",
          last_seen_at: "2026-10-31T10:00:00Z",
          is_current: null,
        },
      ],
      error: null,
    });
    const result = await listDeviceSessions();
    if (!result.ok) throw new Error("expected ok");
    expect(result.sessions[0].label).toBe("Неизвестное устройство");
    expect(result.sessions[0].platform).toBe("Неизвестно");
    // A null is_current is not "current": the badge must not be invented.
    expect(result.sessions[0].isCurrent).toBe(false);
  });
});

describe("readAuthSessionId", () => {
  it("reads the session_id claim out of the access token", async () => {
    currentToken = sessionClaims("11111111-1111-4111-8111-111111111111");
    expect(await readAuthSessionId()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns null without a session rather than inventing one", async () => {
    // The previous version of this function was a stub that ALWAYS returned null, which silently
    // disabled every server-side session binding. A null here is a real fact: no token, no session.
    expect(await readAuthSessionId()).toBeNull();
  });

  it("returns null for a token with no session_id claim", async () => {
    currentToken = ["h", Buffer.from(JSON.stringify({ sub: "u" })).toString("base64url"), "s"].join(".");
    expect(await readAuthSessionId()).toBeNull();
  });

  it("returns null for a malformed token instead of throwing", async () => {
    currentToken = "not-a-jwt";
    expect(await readAuthSessionId()).toBeNull();
  });
});

describe("revocation goes through the auth server, not through our table", () => {
  it("calls the revoke-session function with the local scope for this device", async () => {
    invoke.mockResolvedValue({ data: { revoked: "local" }, error: null });
    expect(await revokeThisDeviceSession()).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("revoke-session", { body: { scope: "local" } });
    // Nothing may write to our own table: that was the bug.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the function with the others scope for the bulk action", async () => {
    invoke.mockResolvedValue({ data: { revoked: "others" }, error: null });
    expect(await revokeOtherDeviceSessions()).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("revoke-session", { body: { scope: "others" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a not-deployed function as not-deployed rather than as success", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "Failed to send a request", context: { status: 404 } } });
    expect(await revokeOtherDeviceSessions()).toEqual({ ok: false, error: "not-deployed" });
  });

  it("treats a body that does not confirm the scope as a failure", async () => {
    // A function that answered something else must never be read as "revoked".
    invoke.mockResolvedValue({ data: { error: "Authentication required" }, error: null });
    expect(await revokeOtherDeviceSessions()).toEqual({ ok: false, error: "refused" });
  });

  it("reports a misconfigured function as not deployed", async () => {
    invoke.mockResolvedValue({ data: { error: "misconfigured" }, error: null });
    expect(await revokeOtherDeviceSessions()).toEqual({ ok: false, error: "not-deployed" });
  });
});
