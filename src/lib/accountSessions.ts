/**
 * The devices signed in to this account, as the server sees them.
 *
 * The rows come from auth.sessions through two functions in migration 20261054. A project
 * that has not run it yet answers "no such function"; the settings screen then keeps the
 * short list this browser remembers, which is all it could show before.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeDevice } from "./sessions";

export type AccountSession = {
  id: string;
  /** Browser, as a person would name it: "Chrome", "Safari". */
  label: string;
  /** "Windows", "iOS" and so on. */
  platform: string;
  ip: string | null;
  lastActive: number;
  current: boolean;
};

export type SessionsResult =
  | { status: "ok"; sessions: AccountSession[] }
  /** The migration has not been run in this project. */
  | { status: "missing" }
  | { status: "error" };

export type SessionRow = {
  id: string;
  created_at: string;
  last_active: string | null;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean | null;
};

type RpcError = { code?: string; message?: string } | null;

/** "No such function": PostgREST's code when its schema has none, Postgres's when it is called anyway. */
export function isMissingFunction(error: RpcError): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883";
}

export function toAccountSession(row: SessionRow): AccountSession {
  const agent = (row.user_agent || "").trim();
  const { label, platform } = agent ? describeDevice(agent) : { label: "Неизвестное устройство", platform: "" };
  const lastActive = Date.parse(row.last_active || row.created_at);
  return {
    id: row.id,
    label,
    platform: platform === "Неизвестно" ? "" : platform,
    ip: row.ip || null,
    lastActive: Number.isFinite(lastActive) ? lastActive : 0,
    current: row.is_current === true,
  };
}

/** This device first, then the most recently active. */
export function sortSessions(sessions: AccountSession[]): AccountSession[] {
  return [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActive - a.lastActive);
}

/** "Chrome · Windows", or just "Chrome" when the platform is unknown. */
export function sessionTitle(session: Pick<AccountSession, "label" | "platform">): string {
  return session.platform ? `${session.label} · ${session.platform}` : session.label;
}

export async function loadAccountSessions(client: SupabaseClient): Promise<SessionsResult> {
  const { data, error } = await client.rpc("my_sessions");
  if (error) return isMissingFunction(error) ? { status: "missing" } : { status: "error" };
  const rows = Array.isArray(data) ? (data as SessionRow[]) : [];
  return { status: "ok", sessions: sortSessions(rows.map(toAccountSession)) };
}

/** "gone" means there was nothing to end: already signed out, or not this account's session. */
export async function endAccountSession(client: SupabaseClient, id: string): Promise<"ended" | "gone" | "missing" | "error"> {
  const { data, error } = await client.rpc("end_session", { target: id });
  if (error) return isMissingFunction(error) ? "missing" : "error";
  return data === true ? "ended" : "gone";
}
