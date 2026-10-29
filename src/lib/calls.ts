import { supabase, supabaseConfig } from "./supabase";

/**
 * Client-side call signalling.
 *
 * All state transitions go through RPCs, never through table writes: the
 * database decides who may answer or end a call, so a modified client cannot
 * approve itself. This module only shapes rows and formats them for the UI.
 */

export type CallKind = "audio" | "video";
export type CallStatus = "ringing" | "active" | "ended" | "missed" | "declined";

export type CallRow = {
  id: string;
  chat_id: string;
  created_by: string;
  kind: CallKind;
  status: CallStatus;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  room_name: string;
};

export type CallToken = {
  provider: string;
  url: string;
  token: string;
  room: string;
  kind: CallKind;
};

/** What the incoming-call banner and the in-call screen need. */
export type ActiveCall = {
  id: string;
  chatId: string;
  kind: CallKind;
  status: CallStatus;
  startedAt: number;
  createdBy: string;
  mine: boolean;
  remoteId: string | null;
};

/** A call is worth showing while it is ringing or in progress. */
export function isLive(status: CallStatus): boolean {
  return status === "ringing" || status === "active";
}

export function toActiveCall(row: CallRow, accountId: string): ActiveCall {
  return {
    id: row.id,
    chatId: row.chat_id,
    kind: row.kind,
    status: row.status,
    startedAt: new Date(row.started_at).getTime(),
    createdBy: row.created_by,
    mine: row.created_by === accountId,
    remoteId: null,
  };
}

/**
 * Decides how a live call should be presented.
 *
 * Split out because the branches are where bugs hide: the caller must never see
 * an "answer" button for their own call, and a call the user already refused
 * must not pop back up.
 */
export type CallPresentation = "outgoing" | "incoming" | "incall" | "hidden";

export function presentCall(call: ActiveCall | null): CallPresentation {
  if (!call) return "hidden";
  if (!isLive(call.status)) return "hidden";
  if (call.status === "ringing") return call.mine ? "outgoing" : "incoming";
  return "incall";
}

/** mm:ss for the in-call timer. */
export function formatCallDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Human label for a call's final state, used in the notice line. */
export function describeCallEnd(status: CallStatus): string {
  switch (status) {
    case "declined":
      return "Звонок отклонён";
    case "missed":
      return "Пропущенный звонок";
    case "ended":
      return "Звонок завершён";
    default:
      return "Звонок";
  }
}

/**
 * Explains why starting a call failed, in terms the user can act on.
 *
 * `CALL_PROVIDER=none` is the current default until credentials exist, and
 * "calling is not configured" is not a useful thing to show a person.
 */
export function describeCallError(message: string | undefined): string {
  const text = (message ?? "").toLowerCase();
  if (text.includes("not configured") || text.includes("not configured")) return "Звонки пока не подключены";
  if (text.includes("already in progress")) return "В этом чате уже идёт звонок";
  if (text.includes("blocked")) return "Пользователь вас заблокировал";
  if (text.includes("authentication required")) return "Войдите, чтобы позвонить";
  if (text.includes("not a member")) return "Вы не участник этого чата";
  return "Не удалось начать звонок";
}

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  if (!supabase) return { data: null, error: "Supabase is not configured" };
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

export async function startCall(chatId: string, kind: CallKind) {
  return callRpc<CallRow>("start_call", { target_chat_id: chatId, call_kind_input: kind });
}

export async function answerCall(callId: string) {
  return callRpc<CallRow>("answer_call", { call_id: callId });
}

export async function endCall(callId: string, outcome: "ended" | "declined" = "ended") {
  return callRpc<CallRow>("end_call", { call_id: callId, outcome });
}

/** Asks the Edge Function for an SFU token for this call. */
export async function fetchCallToken(callId: string): Promise<{ data: CallToken | null; error: string | null; status: number }> {
  if (!supabase) return { data: null, error: "Supabase is not configured", status: 0 };
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return { data: null, error: "Authentication required", status: 401 };

  const baseUrl = supabaseConfig.url;
  const anonKey = supabaseConfig.publishableKey;
  if (!baseUrl || !anonKey) return { data: null, error: "Supabase is not configured", status: 0 };

  const response = await fetch(`${baseUrl}/functions/v1/call-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ callId }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { data: null, error: payload?.error ?? `Call token request failed (${response.status})`, status: response.status };
  }
  return { data: payload as CallToken, error: null, status: response.status };
}
