/**
 * Taking your data out.
 *
 * Two exports with different promises. A single conversation is a text file for reading. The
 * whole account is a JSON archive that has to be complete, because it is what a person takes
 * away on the way out - a new kind of data missing from it would be a silent loss, and a backup
 * cannot afford that.
 *
 * Both live here rather than in the hook that calls them because neither needs anything from
 * React: one takes a conversation and gives a string, the other takes the account and gives a
 * file. Keeping them in the hook made the hook longer without making the behaviour clearer.
 */

import type { Chat } from "../types";
import { archiveFileName, archiveSummary, buildArchive } from "./archive";
import { exportAsText, exportFileName, pluralMessages } from "./exportChat";
import { scopedStore } from "./scopedStorage";

/** A conversation as plain text. */
export function chatAsText(chat: Chat): string {
  const messages = chat.messages.filter((message) => message.id > 0);
  return exportAsText(
    chat.name,
    messages.map((message) => ({
      author: message.author,
      text: message.text,
      createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : undefined,
      attachment: message.attachment
        ? { name: message.attachment.name, type: message.attachment.type, size: message.attachment.size }
        : null,
    })),
    Date.now()
  );
}

/** How many messages a text export actually contains. */
export function chatAsTextCount(chat: Chat): number {
  return chat.messages.filter((message) => message.id > 0).length;
}

export function pluralFor(count: number): string {
  return pluralMessages(count);
}

/** One conversation's shape in the account archive. */
type ArchiveChat = {
  name: string;
  kind: "chat" | "group" | "channel";
  /** Optional on Chat itself; the archive copies whatever is there, including nothing. */
  pinned?: boolean;
  unread?: number;
  messages: {
    author: string;
    text: string;
    createdAt: string | null;
    attachment: { name: string; type: string; size: number } | null;
    viewOnce?: true;
  }[];
};

export function chatsForArchive(chats: Chat[]): ArchiveChat[] {
  return chats
    .filter((chat) => chat.messages.length > 0 || chat.remoteId)
    .map((chat) => ({
      name: chat.name,
      kind: chat.channel ? ("channel" as const) : chat.group ? ("group" as const) : ("chat" as const),
      pinned: chat.pinned,
      unread: chat.unread,
      messages: chat.messages
        .filter((message) => message.id > 0)
        .map((message) => ({
          author: message.author,
          text: message.text,
          createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : null,
          attachment: message.attachment
            ? { name: message.attachment.name, type: message.attachment.type, size: message.attachment.size }
            : null,
          ...(message.attachment?.viewOnce ? { viewOnce: true as const } : {}),
        })),
    }));
}

export type ArchiveSettings = {
  theme: string | null;
  language: string | null;
  wallpaper: string | null;
  privacy: unknown;
  notifications: unknown;
  folders: unknown;
};

/**
 * Settings are passed through rather than reinterpreted: the archive is a copy, not a translation.
 *
 * Read from the account's own namespace, so an export contains the settings of the account being
 * exported and not whichever of the browser's accounts last changed a theme.
 */
export function settingsForArchive(accountId: string | null): Pick<ArchiveSettings, "theme" | "language" | "wallpaper"> {
  if (typeof window === "undefined") return { theme: null, language: null, wallpaper: null };
  const store = scopedStore(accountId);
  return {
    theme: store.read("nexus-theme"),
    language: store.read("nexus-language"),
    wallpaper: store.read("nexus-wallpaper"),
  };
}

export type ArchiveParts = {
  profile: { name: string; username: string | null };
  chats: ArchiveChat[];
  settings: ArchiveSettings;
};

export function buildAccountArchive(input: {
  profileName: string;
  username?: string | null;
  chats: Chat[];
  privacy: unknown;
  notifications: unknown;
  folders: unknown;
  /** Whose settings to copy: the archive belongs to one account, not to the browser. */
  accountId?: string | null;
}): { parts: ArchiveParts; text: string; summary: string } {
  const parts: ArchiveParts = {
    profile: { name: input.profileName, username: input.username ?? null },
    chats: chatsForArchive(input.chats),
    settings: {
      ...settingsForArchive(input.accountId ?? null),
      privacy: input.privacy,
      notifications: input.notifications,
      folders: input.folders,
    },
  };
  const text = buildArchive(parts, Date.now());
  return { parts, text, summary: archiveSummary(parts) };
}

export function archiveName(): string {
  return archiveFileName(Date.now());
}

/** Triggers a download without leaving a link behind. */
export function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
