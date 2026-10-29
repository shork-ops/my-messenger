/**
 * Exporting a conversation.
 *
 * A backup is only worth having if it can be read years later by something other
 * than this app, so the text format is plain and ordered, and the JSON keeps the
 * fields rather than a rendering of them.
 */

export type ExportableMessage = {
  author: string;
  text: string;
  /** ISO timestamp, or empty when the message predates timestamps. */
  createdAt?: string;
  attachment?: { name: string; type: string; size: number } | null;
};

/** "2 сообщения" rather than "2 сообщений", for the confirmation. */
export function pluralMessages(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} сообщение`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} сообщения`;
  return `${count} сообщений`;
}

/** The file name, which carries the chat and the date so two exports can be told apart. */
export function exportFileName(chatName: string, now: number, extension: "txt" | "json"): string {
  const day = new Date(now).toISOString().slice(0, 10);
  // Characters a file system rejects become a dash; the readable part is kept.
  const safe = chatName.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 40) || "chat";
  return `${safe} ${day}.${extension}`;
}

/** "29 октября 2026, 14:05" — the form a person reads. */
export function formatExportStamp(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day}, ${time}`;
}

/** One line of the text export, with the attachment noted rather than lost. */
export function messageLine(message: ExportableMessage): string {
  const stamp = formatExportStamp(message.createdAt);
  const head = stamp ? `[${stamp}] ${message.author}` : message.author;
  const attachment = message.attachment ? `\n  вложение: ${message.attachment.name} (${message.attachment.type})` : "";
  return `${head}: ${message.text}${attachment}`;
}

/**
 * The whole conversation as text.
 *
 * The header says what this is, because a file found on a disk a year later should
 * explain itself without the app that made it.
 */
export function exportAsText(chatName: string, messages: ExportableMessage[], now: number): string {
  const header = [`Переписка: ${chatName}`, `Выгружено: ${formatExportStamp(new Date(now).toISOString())}`, `Сообщений: ${messages.length}`, ""].join("\n");
  const body = messages.map(messageLine).join("\n\n");
  return `${header}${body}\n`;
}

/** The structured export, which keeps the fields rather than a rendering of them. */
export function exportAsJson(chatName: string, messages: ExportableMessage[], now: number): string {
  return JSON.stringify(
    {
      chat: chatName,
      exportedAt: new Date(now).toISOString(),
      count: messages.length,
      messages: messages.map((message) => ({
        author: message.author,
        text: message.text,
        createdAt: message.createdAt ?? null,
        attachment: message.attachment ?? null,
      })),
    },
    null,
    2
  );
}
