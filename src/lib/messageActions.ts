import type { Message } from "../types";

/**
 * Forwarding, pinning and favourites are all client-side concerns:
 *
 * - a forward is a new message whose body names the source and whose sender is
 *   whoever forwards it, so the server's sender checks keep working unchanged;
 * - the favourites chat is a normal direct chat with the user themselves,
 *   which means no new tables and the same offline behaviour as any chat.
 */

/** Prefix that marks a forwarded message, e.g. `↪ Переслано от Аня:`. */
export const FORWARD_PREFIX = "↪ Переслано";

export function formatForwardText(source: Pick<Message, "author" | "text">): string {
  const body = source.text.trim();
  return `${FORWARD_PREFIX} от ${source.author}:\n${body}`;
}

export function isForwarded(text: string): boolean {
  return text.startsWith(FORWARD_PREFIX);
}

/** Body shown in the bubble for a forwarded message: the prefix becomes a label. */
export function splitForward(text: string): { label: string | null; body: string } {
  if (!isForwarded(text)) return { label: null, body: text };
  const newline = text.indexOf("\n");
  if (newline === -1) return { label: text, body: "" };
  return { label: text.slice(0, newline), body: text.slice(newline + 1) };
}

/**
 * The favourites chat is identified by a stable local id so it survives
 * restarts, and by a reserved title so it can be found after a re-sync.
 */
export const FAVOURITES_CHAT_ID = -1;
export const FAVOURITES_TITLE = "Избранное";

export function createFavouritesChat(): { id: number; name: string; avatar: string; color: string; preview: string; time: string; messages: Message[] } {
  return {
    id: FAVOURITES_CHAT_ID,
    name: FAVOURITES_TITLE,
    avatar: "★",
    color: "orange",
    preview: "Сообщения, сохранённые для себя",
    time: "",
    messages: [],
  };
}

export function isFavouritesChat(chat: { id: number; name: string }): boolean {
  return chat.id === FAVOURITES_CHAT_ID || chat.name === FAVOURITES_TITLE;
}

/** Favourites are private, so they never leave this browser and never sync. */
export function favouriteMessage(message: Message, nextId: number): Message {
  return {
    id: nextId,
    author: message.author,
    text: message.text,
    time: "",
    mine: true,
    createdAt: Date.now(),
    attachment: message.attachment,
    poll: message.poll,
    replyTo: { author: message.author, text: message.text.slice(0, 160) },
    reactions: [],
  };
}

/** Highest numeric local id in a chat, so new messages never collide. */
export function nextLocalId(messages: Message[]): number {
  return messages.reduce((max, message) => (message.id > max ? message.id : max), 0) + 1;
}
