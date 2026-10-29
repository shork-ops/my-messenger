import { supabase } from "../lib/supabase";
import { clockTime, numericId } from "../lib/format";
import type { Attachment, ChatMessageRow, Message } from "../types";

const MESSAGE_COLUMNS = "id, chat_id, sender_id, body, attachment, effect, poll, reply_to, created_at, edited_at, deleted_at";

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
    ...(expiresAt ? { expiresAt } : {}),
    ...(meta.thumbnail ? { thumbnail: meta.thumbnail } : {}),
    ...(typeof meta.width === "number" ? { width: meta.width } : {}),
    ...(typeof meta.height === "number" ? { height: meta.height } : {}),
    ...(typeof meta.duration === "number" ? { duration: meta.duration } : {}),
    ...(Array.isArray(meta.waveform) ? { waveform: meta.waveform } : {}),
  };
}

/**
 * Converts a Supabase message row into the client model.
 * Returns null for rows that have no remote id (should not happen for server data).
 */
export async function mapMessageRow(row: ChatMessageRow, options: MapOptions): Promise<Message | null> {
  if (!row?.id) return null;
  const attachmentMeta = row.attachment as AttachmentMeta | null;
  let attachment: Message["attachment"];
  if (attachmentMeta && supabase) {
    let data = "";
    let expiresAt: number | undefined;
    if (attachmentMeta.path) {
      const { data: signed } = await supabase.storage
        .from("chat-media")
        .createSignedUrl(attachmentMeta.path, SIGNED_URL_TTL_SECONDS);
      data = signed?.signedUrl || "";
      if (data) expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
    }
    attachment = toAttachment(attachmentMeta, data, expiresAt);
  }
  const created = new Date(row.created_at);
  const mine = row.sender_id === options.accountId;
  return {
    id: numericId(row.id),
    remoteId: row.id,
    author: mine ? options.selfName : options.authorName,
    text: row.deleted_at ? "Сообщение удалено" : row.body,
    time: clockTime(created),
    mine,
    createdAt: created.getTime(),
    edited: Boolean(row.edited_at),
    ...(row.effect ? { effect: row.effect } : {}),
    ...(row.poll ? { poll: row.poll as Message["poll"] } : {}),
    ...(attachment ? { attachment } : {}),
    reactions: [],
  };
}

/** Loads the newest page of a chat (keyset pagination sorted newest first). */
export async function fetchLatestMessages(chatId: string, limit: number): Promise<ChatMessageRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return null;
  return (data ?? []) as ChatMessageRow[];
}

/**
 * Loads one page of older messages strictly before the `(createdAt, id)` cursor.
 * PostgREST evaluates the `or` filter left to right:
 * `created_at < cursor OR (created_at = cursor AND id < cursor.id)`.
 */
export async function fetchOlderMessages(
  chatId: string,
  cursor: { createdAt: string; id: string },
  limit: number
): Promise<ChatMessageRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("chat_id", chatId)
    .or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return null;
  return (data ?? []) as ChatMessageRow[];
}

/** Loads reaction emojis for a set of messages, grouped by message id. */
export async function fetchReactions(messageIds: string[]): Promise<Record<string, string[]>> {
  if (!supabase || messageIds.length === 0) return {};
  const { data } = await supabase.from("message_reactions").select("message_id, emoji").in("message_id", messageIds);
  const grouped: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const bucket = (grouped[row.message_id as string] ??= []);
    if (row.emoji) bucket.push(row.emoji as string);
  }
  return grouped;
}
