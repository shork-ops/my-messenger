import type { SupabaseClient } from "@supabase/supabase-js";
import { isTransientError, withRetry } from "./retry";
import { exceedsMessageLimit, MESSAGE_TOO_LONG } from "./messageLimits";

/** A stable UUID makes retries safe even when the insert succeeded but its response was lost. */
export async function sendText(client: SupabaseClient, message: { id: string; chat_id: string; sender_id: string; body: string; send_at?: string }) {
  if (exceedsMessageLimit(message.body)) throw new Error(MESSAGE_TOO_LONG);
  return withRetry(async () => {
    const result = await client.from("messages").insert(message).select("id, created_at").single();
    if (result.error?.code === "23505") {
      const existing = await client.from("messages").select("id, created_at, body").eq("id", message.id).eq("chat_id", message.chat_id).eq("sender_id", message.sender_id).single();
      if (!existing.error && existing.data?.body === message.body) return existing.data as { id: string; created_at: string };
    }
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Server did not acknowledge the message");
    return result.data as { id: string; created_at: string };
  }, { shouldRetry: isTransientError });
}
