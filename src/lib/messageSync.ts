import { supabase } from "../lib/supabase";
import { clockTime, numericId } from "../lib/format";
import type { Attachment, ChatMessageRow, Message } from "../types";

/**
 * How long a signed attachment URL stays valid.
 *
 * An hour used to be enough because history was only mapped on load, but a tab
 * left open overnight kept dead URLs: images and voice messages stopped loading
 * with no error the user could act on. The URL is now also refreshed before it
 * expires (see `useAttachmentRefresh`), and the longer window leaves room for
 * that refresh to happen without visible breakage.
 */
export const SIGNED_URL_TTL_SECONDS = 3600;

/** Refreshes an attachment URL this long before it lapses. */
export const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60_000;

type AttachmentMeta = {
  name?: string;
  type?: string;
  size?: number;
  path?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  duration?: number;
  waveform?: number[];
  viewOnce?: boolean;
  videoNote?: boolean;
  bucket?: "chat-media" | "view-once-media";
};

type MapOptions = {
  accountId: string;
  selfName: string;
  /** Display names of other members, used as the author label for inbound messages. */
  authorName: string;
};

/**
 * Rebuilds the client attachment from the JSON stored on the message row.
 *
 * Every field the sender stored has to survive the round trip. Dropping one is
 * invisible in the composer but breaks the receiver: a voice message loses its
 * waveform, a photo loses its instant preview. Pure, so it is unit tested.
 */
export function toAttachment(meta: AttachmentMeta, data: string, expiresAt?: number): Attachment {
  return {
    name: meta.name || "Вложение",
    type: meta.type || "application/octet-stream",
    size: meta.size || 0,
    data,
    ...(meta.path ? { path: meta.path } : {}),
    ...(meta.viewOnce ? { viewOnce: true, bucket: meta.bucket, data: "" } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(meta.thumbnail && !meta.viewOnce ? { thumbnail: meta.thumbnail } : {}),
    ...(typeof meta.width === "number" ? { width: meta.width } : {}),
    ...(typeof meta.height === "number" ? { height: meta.height } : {}),
    ...(typeof meta.duration === "number" ? { duration: meta.duration } : {}),
    ...(Array.isArray(meta.waveform) ? { waveform: meta.waveform } : {}),
    ...(meta.videoNote ? { videoNote: true } : {}),
  };
}

/**
 * Converts a Supabase message row into the client model.
 * Returns null for rows that have no remote id (should not happen for server data).
 */
export async function mapMessageRow(row: ChatMessageRow, options: MapOptions): Promise<Message | null> {
  if (!row?.id) return null;
  const attachmentMeta = row.deleted_at ? null : row.attachment as AttachmentMeta | null;
  let attachment: Message["attachment"];
  if (attachmentMeta && supabase) {
    let data = "";
    let expiresAt: number | undefined;
    if (attachmentMeta.path && !attachmentMeta.viewOnce) {
      const { data: signed } = await supabase.storage
        .from("chat-media")
        .createSignedUrl(attachmentMeta.path, SIGNED_URL_TTL_SECONDS);
      data = signed?.signedUrl || "";
      if (data) expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
    }
    attachment = toAttachment(attachmentMeta, data, expiresAt);
  }
  const historyAt = row.timeline_at ?? row.send_at ?? row.created_at;
  const created = new Date(historyAt);
  const mine = row.sender_id === options.accountId;
  return {
    id: numericId(row.id),
    remoteId: row.id,
    author: mine ? options.selfName : options.authorName,
    text: row.deleted_at ? "Сообщение удалено" : row.body,
    time: clockTime(created),
    mine,
    createdAt: created.getTime(),
    historyAt,
    sendAt: row.history_pending && row.send_at ? Date.parse(row.send_at) : undefined,
    edited: Boolean(row.edited_at),
    ...(row.expires_at && !Number.isNaN(Date.parse(row.expires_at)) ? { disappearsAt: Date.parse(row.expires_at) } : {}),
    effect: row.deleted_at ? undefined : row.effect ?? undefined,
    poll: row.deleted_at ? undefined : (row.poll as Message["poll"]) ?? undefined,
    attachment,
    ...(row.deleted_at ? { replyTo: undefined, album: undefined } : {}),
    reactions: [],
  };
}

/**
 * Ids of messages this account chose to hide ("у себя").
 *
 * Read once per page rather than joined into the message query: the set is small
 * and the join would make every page depend on a second table.
 */
export async function fetchHiddenMessageIds(messageIds: string[]): Promise<Set<string> | null> {
  if (!supabase || messageIds.length === 0) return new Set();
  const { data, error } = await supabase.from("message_hides").select("message_id").in("message_id", messageIds);
  // A failed privacy lookup must not reveal messages hidden on another device.
  if (error) return null;
  return new Set((data ?? []).map((row) => row.message_id as string));
}

/** Server filters due/hidden rows before LIMIT, so a short page means exhaustion. */
export async function fetchLatestMessages(chatId: string, limit: number): Promise<ChatMessageRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("message_history_page", { p_chat: chatId, p_limit: limit });
  return error || !Array.isArray(data) ? null : data as ChatMessageRow[];
}

export async function fetchOlderMessages(chatId: string, cursor: { createdAt: string; id: string }, limit: number): Promise<ChatMessageRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("message_history_page", {
    p_chat: chatId, p_before_at: cursor.createdAt, p_before_id: cursor.id, p_limit: limit,
  });
  return error || !Array.isArray(data) ? null : data as ChatMessageRow[];
}

/** Loads reaction emojis for a set of messages, grouped by message id. */
export async function fetchReactions(messageIds: string[], strict = false): Promise<Record<string, string[]>> {
  if (!supabase || messageIds.length === 0) return {};
  const { data, error } = await supabase.from("message_reactions").select("message_id, emoji").in("message_id", messageIds);
  if (error && strict) throw error;
  const grouped: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const bucket = (grouped[row.message_id as string] ??= []);
    if (row.emoji) bucket.push(row.emoji as string);
  }
  return grouped;
}

/** Refresh every already loaded ID, including rows older than the latest page.
 * A missing row is authoritative only when all queries succeeded. */
export async function fetchKnownMessages(chatId: string, ids: string[]): Promise<ChatMessageRow[] | null> {
  const client=supabase;
  if(!client)return null;
  const rows: ChatMessageRow[]=[];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await client.rpc("message_history_known", {p_chat: chatId, p_ids: ids.slice(offset,offset+100)});
    if (result.error || !Array.isArray(result.data)) return null;
    rows.push(...result.data as ChatMessageRow[]);
  }
  return rows;
}
