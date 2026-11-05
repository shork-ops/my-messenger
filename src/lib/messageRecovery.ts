import { supabase } from "./supabase";
import type { ChatMessageRow } from "../types";

/** Inclusive overlap with the loaded window also catches old rows whose send_at became due. */
export async function fetchRecoveryMessages(chatId: string, since: number): Promise<ChatMessageRow[] | null> {
  if (!supabase || !Number.isFinite(since)) return null;
  const rows: ChatMessageRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const result = await supabase.rpc("recover_chat_messages", {
      p_chat: chatId, p_since: new Date(since).toISOString(), p_after: cursor, p_limit: 100,
    });
    if (result.error || !Array.isArray(result.data)) return null;
    const batch = result.data as ChatMessageRow[];
    if (batch.some(row => !row.id || row.chat_id !== chatId || (cursor !== null && row.id <= cursor))) return null;
    rows.push(...batch);
    if (batch.length < 100) return rows;
    const next = batch[batch.length - 1].id;
    if (next === cursor) return null;
    cursor = next;
  }
  // Do not apply an incomplete snapshot or allocate an unbounded history in memory.
  return null;
}
