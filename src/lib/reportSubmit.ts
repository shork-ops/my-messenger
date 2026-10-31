/**
 * Filing a complaint with the server.
 *
 * The decisions about what a report means live in `reports.ts`; this module only talks to the
 * database and turns its answers into something the interface can show. The split matters
 * because the server is not available in demo mode and in tests: everything that decides
 * whether a button appears has to work without it.
 *
 * The server function refuses duplicates by returning the existing row, and refuses a report
 * about a message the reporter cannot see. Both are answered here as facts, not as failures.
 */

import { supabase } from "./supabase";
import { clampDetails, isReportable, reportError, type ReportReason, type ReportTarget } from "./reports";

export type ReportOutcome =
  | { ok: true; duplicate: boolean }
  | { ok: false; message: string };

/**
 * Files a report.
 *
 * Returns a duplicate rather than an error when the same person already reported the same
 * thing: the button was pressed twice or the person forgot, and neither is a failure worth a
 * red banner.
 */
export async function submitReport(
  target: ReportTarget,
  reason: ReportReason,
  details: string
): Promise<ReportOutcome> {
  if (!isReportable(target)) {
    return { ok: false, message: "На это пожаловаться нельзя: разговор ещё не сохранён" };
  }
  if (!supabase) {
    return { ok: false, message: "Нет подключения к серверу" };
  }

  const clamped = clampDetails(details);
  const { data, error } = await supabase.rpc("report_content", {
    target_chat_id: target.messageId ? null : target.chatId,
    target_message_id: target.messageId,
    report_reason: reason,
    report_details: clamped.text,
  });

  if (error) {
    // The server raises named errors; anything else is a network or permission problem the
    // person can only retry.
    return { ok: false, message: reportError(extractCode(error)) };
  }

  // The RPC returns the row id. A duplicate returns the same id as the first call, and the
  // interface needs to know which of the two happened to word the answer honestly.
  return { ok: true, duplicate: Boolean(data === null) };
}

/**
 * Pulls the named error out of a Supabase error.
 *
 * Postgres raises the message we chose; the client wraps it. Reading `details` and `hint` too
 * because the wrapper puts it in different places depending on the path - a missing subject
 * arrives in `message`, a rejected reason in `details`.
 */
function extractCode(error: { message?: string; details?: string; hint?: string }): string | undefined {
  const haystack = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  for (const code of ["not_a_member", "message_not_found", "not_authenticated", "no_subject", "bad_reason"]) {
    if (haystack.includes(code)) return code;
  }
  return undefined;
}

/**
 * Whether this person already has an open complaint about a target.
 *
 * Used to keep the button from offering a complaint that would only be refused. Failure reads
 * as "no open report": an unreadable status must not block a legitimate complaint.
 */
export async function hasOpenReport(target: ReportTarget, reporterId: string | null): Promise<boolean> {
  if (!supabase || !reporterId || !isReportable(target)) return false;
  let query = supabase
    .from("content_reports")
    .select("id")
    .eq("reporter_id", reporterId)
    .eq("status", "open")
    .limit(1);
  query = target.messageId ? query.eq("message_id", target.messageId) : query.eq("chat_id", target.chatId).is("message_id", null);
  const { data, error } = await query;
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}
