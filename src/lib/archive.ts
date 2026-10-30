/**
 * The whole archive: every conversation, the profile, and the settings, in one file.
 *
 * This is a different promise from exporting one conversation. A single-chat export is a copy
 * of something you can still see in the app; an archive is what you take away when you leave,
 * and it has to be complete enough that nothing is lost that the app was holding.
 *
 * Two rules follow from that.
 *
 * The first is completeness by construction: the archive asks each part of the app for its
 * data rather than being assembled by hand at the call site, so a new kind of data cannot be
 * quietly left out - `ArchiveParts` is a type that has to be filled.
 *
 * The second is honesty about what cannot be included. The archive holds text, and pictures
 * are written as links that expire. That is stated in the file itself, because the person
 * reading it in a year needs to know whether the empty attachments are a bug or a limit.
 */

export type ArchiveMessage = {
  author: string;
  text: string;
  createdAt?: string | null;
  /** Attachment metadata; the bytes themselves are not inlined. */
  attachment?: { name: string; type: string; size: number } | null;
  /** Set when the sender meant this to be opened once; the archive keeps the marker. */
  viewOnce?: boolean;
};

export type ArchiveChat = {
  name: string;
  kind: "chat" | "group" | "channel";
  pinned?: boolean;
  unread?: number;
  messages: ArchiveMessage[];
};

/** Everything the archive is made of. Each field is a part of the app that holds data. */
export type ArchiveParts = {
  profile: { name: string; username?: string | null };
  chats: ArchiveChat[];
  /** Settings as the app stores them; passed through rather than reinterpreted. */
  settings: Record<string, unknown>;
  folders?: unknown[];
};

export const ARCHIVE_FORMAT = "nexus-archive";
export const ARCHIVE_VERSION = 1;

/** "Файл архива Nexus, 29 октября 2026" — the name a person sees in their downloads. */
export function archiveFileName(now: number): string {
  const day = new Date(now).toISOString().slice(0, 10);
  return `Nexus ${day}.json`;
}

/** How many messages the archive holds, which is what the confirmation reports. */
export function archiveMessageCount(parts: ArchiveParts): number {
  return parts.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
}

/** "12 чатов, 340 сообщений" rather than two separate sentences. */
export function pluralChats(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} чат`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} чата`;
  return `${count} чатов`;
}

export function archiveSummary(parts: ArchiveParts): string {
  const messages = archiveMessageCount(parts);
  const mod10 = messages % 10;
  const mod100 = messages % 100;
  const messagesLabel =
    mod10 === 1 && mod100 !== 11
      ? `${messages} сообщение`
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? `${messages} сообщения`
        : `${messages} сообщений`;
  return `${pluralChats(parts.chats.length)}, ${messagesLabel}`;
}

/**
 * The archive as JSON.
 *
 * Newlines are not escaped into the file's whitespace but left as they are inside strings, so
 * a message written over several lines reads as several lines in any editor. The file is
 * formatted, not minified: something a person may open and read should look readable.
 */
export function buildArchive(parts: ArchiveParts, now: number): string {
  return JSON.stringify(
    {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: new Date(now).toISOString(),
      // Said in the file rather than only in the interface: an archive read a year later should
      // explain itself.
      note: "Текст, настройки и список вложений. Сами файлы в архив не входят: они остаются на сервере и доступны только из приложения.",
      profile: parts.profile,
      settings: parts.settings,
      folders: parts.folders ?? [],
      chats: parts.chats,
      total: { chats: parts.chats.length, messages: archiveMessageCount(parts) },
    },
    null,
    2
  );
}

/**
 * Reads an archive back, for the tests and for anything that wants to verify a backup.
 *
 * It refuses a file that is not this format rather than returning a half-parsed object: an
 * archive that loads partially is worse than one that says it is the wrong file.
 */
export function parseArchive(text: string): ArchiveParts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.format !== ARCHIVE_FORMAT) return null;
  const profile = record.profile as ArchiveParts["profile"] | undefined;
  const chats = record.chats as ArchiveChat[] | undefined;
  if (!profile || typeof profile.name !== "string" || !Array.isArray(chats)) return null;
  return {
    profile,
    chats,
    settings: (record.settings as Record<string, unknown>) ?? {},
    folders: Array.isArray(record.folders) ? record.folders : [],
  };
}
