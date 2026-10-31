/**
 * The session list, as a screen needs it.
 *
 * Three states matter and the screen must be able to tell them apart, because showing a plausible
 * empty list when the truth is "the server refused" or "this was never deployed" is how a settings
 * screen starts lying. `kind` carries that distinction:
 *
 * - `loading` — nothing to say yet.
 * - `ready` — a real list from the server.
 * - `unavailable` — the server could not answer. The screen says so instead of drawing "no other
 *   devices", which would be a claim about the account rather than about the request.
 *
 * Every action re-reads the list afterwards rather than editing it locally: the server decides what
 * is revoked, and a local edit would show a state the server does not agree with.
 *
 * Revocation itself does not happen here. It goes through the `revoke-session` Edge Function, because
 * only a component holding the service role key can end a session in Supabase Auth, and a flag in our
 * own table is not something the auth server consults. See `src/lib/deviceSessions.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listDeviceSessions,
  registerDeviceSession,
  revokeOtherDeviceSessions,
  revokeThisDeviceSession,
  type DeviceSession,
  type SessionError,
} from "../lib/deviceSessions";

export type SessionListState =
  | { kind: "loading" }
  | { kind: "ready"; sessions: DeviceSession[] }
  | { kind: "unavailable"; error: SessionError };

export type RevokeOutcome = { ok: true } | { ok: false; error: SessionError };

export type DeviceSessionsHook = {
  state: SessionListState;
  /** Reloads from the server, e.g. when the screen is opened. */
  refresh: () => Promise<void>;
  /** Ends every session except this one, through the auth server. */
  revokeOthers: () => Promise<RevokeOutcome>;
  /** Ends this device's own session, through the auth server. */
  revokeThis: () => Promise<RevokeOutcome>;
  /** True while an action is in flight, so the buttons can be disabled. */
  busy: boolean;
  /** The last action's failure, for a one-line message. Cleared by the next action. */
  actionError: SessionError | null;
  /** Set when revocation worked but the list could not be updated, so the screen can say so. */
  actionWarning: string | null;
};

/**
 * Registers this browser once per sign-in and exposes the list.
 *
 * Registration is deliberately not awaited by the list read: a failing registration must not hide a
 * list that would otherwise be available, and the list is the more useful of the two when only one of
 * them works.
 *
 * `onRevoked` fires only after the server confirmed a revocation, and says which scope was revoked.
 * It exists so the caller can show a notice or clear the local session without having to guess that
 * the action worked.
 */
export function useDeviceSessions(
  accountId: string | null,
  options: { onRevoked?: (scope: "local" | "others") => void } = {}
): DeviceSessionsHook {
  const [state, setState] = useState<SessionListState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<SessionError | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);

  // Guards against a response from a previous account landing in this one's state.
  const generation = useRef(0);

  // Held in a ref so a new callback identity does not re-run the registration effect.
  const onRevoked = useRef(options.onRevoked);
  onRevoked.current = options.onRevoked;

  const load = useCallback(async () => {
    const mine = ++generation.current;
    const result = await listDeviceSessions();
    if (mine !== generation.current) return;
    setState(
      result.ok
        ? { kind: "ready", sessions: result.sessions }
        : { kind: "unavailable", error: result.error }
    );
  }, []);

  useEffect(() => {
    if (!accountId) {
      // Signed out: there is no account whose sessions could be listed, and showing the previous
      // account's list here would be the isolation bug in a new place.
      generation.current += 1;
      setState({ kind: "loading" });
      setBusy(false);
      setActionError(null);
      setActionWarning(null);
      return;
    }
    let alive = true;
    (async () => {
      await registerDeviceSession();
      if (!alive) return;
      await load();
    })();
    return () => {
      alive = false;
      generation.current += 1;
    };
  }, [accountId, load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const revokeOthers = useCallback(async (): Promise<RevokeOutcome> => {
    setBusy(true);
    setActionError(null);
    setActionWarning(null);
    try {
      const result = await revokeOtherDeviceSessions();
      if (!result.ok) {
        setActionError(result.error);
      } else {
        // Only now, and only on success: the notice must never announce something the server
        // refused.
        onRevoked.current?.("others");
      }
      // Reload either way: a refusal usually means the list on screen is stale.
      await load();
      return result;
    } finally {
      setBusy(false);
    }
  }, [load]);

  const revokeThis = useCallback(async (): Promise<RevokeOutcome> => {
    setBusy(true);
    setActionError(null);
    setActionWarning(null);
    try {
      const result = await revokeThisDeviceSession();
      if (!result.ok) {
        setActionError(result.error);
      } else {
        onRevoked.current?.("local");
      }
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  return useMemo(
    () => ({ state, refresh, revokeOthers, revokeThis, busy, actionError, actionWarning }),
    [state, refresh, revokeOthers, revokeThis, busy, actionError, actionWarning]
  );
}
