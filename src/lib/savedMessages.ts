import type { Dispatch, SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, Chat, Message } from "../types";
import { clockTime, numericId } from "./format";
import { createFavouritesChat, isFavouritesChat } from "./messageActions";
import { SIGNED_URL_TTL_SECONDS, toAttachment } from "./messageSync";

/**
 * «Избранное» on the server (supabase/migrations/20261056_saved_messages.sql).
 *
 * In a cloud account the chat list is read from the server on every start, so favourites that
 * lived only in the open tab were gone after a reload - and after any realtime reload of the
 * list too. Each saved message is now a row of its own: a copy of the text, the author's name
 * and the attachment's description, readable by its owner only.
 *
 * The favourites chat stays a chat of this browser (it has no `remoteId`); what is on the
 * server is its messages, each remembering its row in `savedId`. A message still on its way
 * (no `savedId` yet) is kept when the list is reloaded, so nothing saved is lost to a race.
 *
 * Loaded on demand only, so the first screen does not grow.
 */

type AttachmentMeta = Parameters<typeof toAttachment>[0];

export type SavedRow = {
  id: string;
  author: string | null;
  body: string | null;
  attachment: AttachmentMeta | null;
  created_at: string;
};

/** The attachment JSON column is capped at 32 KB; a preview picture is the only big part. */
const ATTACHMENT_LIMIT = 30_000;

const NO_TABLE = "Избранное сохранится только до перезагрузки: в Supabase нужна миграция saved_messages";
const NOT_SAVED = "Не удалось сохранить в облако: сообщение останется в избранном до перезагрузки";

/** A server that has not had the migration answers with one of these. */
export function isMissingSavedTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || Boolean(error.message?.includes("saved_messages"));
}

/**
 * One saved row as a message of the favourites chat. Pure.
 *
 * Someone else's message is shown under a quote with their name, as when it was saved; a
 * message of one's own, a note to oneself included, is shown as it is.
 */
export function savedRowToMessage(row: SavedRow, selfName: string, signedUrl = "", expiresAt?: number): Message {
  const createdAt = Date.parse(row.created_at) || Date.now();
  const author = row.author || "Вы";
  const text = row.body ?? "";
  return {
    id: numericId(row.id),
    savedId: row.id,
    author,
    text,
    time: clockTime(new Date(createdAt)),
    mine: true,
    createdAt,
    ...(author !== selfName ? { replyTo: { author, text: text.slice(0, 160) } } : {}),
    reactions: [],
    ...(row.attachment ? { attachment: toAttachment(row.attachment, signedUrl, signedUrl ? expiresAt : undefined) } : {}),
  };
}

/**
 * What of an attachment is copied to the server, or null when nothing should be.
 *
 * The link itself is never stored - it lapses within the hour - only the file's place, from
 * which a fresh link is made on every load. A file that was never uploaded (a local chat's
 * data URL) has no place to point to, and a photo "to be seen once" is never kept. Pure.
 */
export function storableAttachment(attachment: Attachment | undefined): AttachmentMeta | null {
  if (!attachment || attachment.viewOnce || !attachment.path) return null;
  const { data: _data, expiresAt: _expiresAt, bucket: _bucket, viewOnce: _viewOnce, ...rest } = attachment;
  if (JSON.stringify(rest).length <= ATTACHMENT_LIMIT) return rest;
  const { thumbnail: _thumbnail, waveform: _waveform, ...small } = rest;
  return small;
}

/**
 * Puts the server's favourites together with what this tab still holds.
 *
 * The server's rows win; a message of this tab without `savedId` (still being saved, or saved
 * while the server could not take it) stays, unless the same text by the same author already
 * came back from the server within a minute of it. Pure.
 */
export function mergeFavourites(cloud: Message[] | null, local: Chat | undefined): Chat | null {
  if (!cloud && !local) return null;
  const base = local ?? createFavouritesChat();
  if (!cloud) return base;
  const pending = base.messages.filter(
    (message) =>
      !message.savedId &&
      !cloud.some(
        (row) =>
          row.text === message.text &&
          row.author === message.author &&
          Math.abs((row.createdAt ?? 0) - (message.createdAt ?? 0)) < 60_000
      )
  );
  const messages = [...cloud, ...pending].sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
  if (messages.length === 0 && !local) return null;
  const last = messages[messages.length - 1];
  return {
    ...base,
    messages,
    preview: last?.text || createFavouritesChat().preview,
    time: last ? last.time : "",
  };
}

/** Reads this account's saved messages, oldest first, or null when the server has none to give. */
export async function loadSavedMessages(client: SupabaseClient, selfName: string): Promise<Message[] | null> {
  const { data, error } = await client
    .from("saved_messages")
    .select("id, author, body, attachment, created_at")
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error || !data) return null;
  const rows = data as SavedRow[];
  const paths = [...new Set(rows.map((row) => row.attachment?.path).filter((path): path is string => Boolean(path)))];
  const links = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await client.storage.from("chat-media").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) links.set(entry.path, entry.signedUrl);
    }
  }
  const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
  return rows.map((row) => savedRowToMessage(row, selfName, row.attachment?.path ? links.get(row.attachment.path) ?? "" : "", expiresAt));
}

/** Copies a message to the server; the new row's id, or the reason it could not be stored. */
export async function storeSavedMessage(
  client: SupabaseClient,
  message: Pick<Message, "author" | "text" | "attachment">
): Promise<{ id: string } | { error: string }> {
  const attachment = storableAttachment(message.attachment);
  const body = message.text.trim() || (attachment ? "" : message.attachment?.name || "Вложение");
  const { data, error } = await client
    .from("saved_messages")
    .insert({ author: message.author.slice(0, 200), body: body.slice(0, 10_000), attachment })
    .select("id")
    .single();
  if (error || !data) return { error: isMissingSavedTable(error) ? NO_TABLE : NOT_SAVED };
  return { id: (data as { id: string }).id };
}

/** Corrects the text of a saved message; the only part of it that can be changed. */
export async function editSavedMessage(client: SupabaseClient, savedId: string, text: string): Promise<boolean> {
  const { error } = await client.from("saved_messages").update({ body: text.slice(0, 10_000) }).eq("id", savedId);
  return !error;
}

export async function deleteSavedMessage(client: SupabaseClient, savedId: string): Promise<boolean> {
  const { error } = await client.from("saved_messages").delete().eq("id", savedId);
  return !error;
}

/** Saves a message of the favourites chat on the server and marks it with its row. */
export async function rememberInCloud(
  client: SupabaseClient,
  message: Message,
  setChats: Dispatch<SetStateAction<Chat[]>>,
  notify: (text: string) => void
): Promise<void> {
  const result = await storeSavedMessage(client, message);
  if ("error" in result) {
    notify(result.error);
    return;
  }
  setChats((current) =>
    current.map((chat) =>
      isFavouritesChat(chat)
        ? { ...chat, messages: chat.messages.map((item) => (item.id === message.id ? { ...item, savedId: result.id } : item)) }
        : chat
    )
  );
}
