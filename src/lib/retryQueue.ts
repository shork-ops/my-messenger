/**
 * Files that failed to send, kept so the person can try again without finding them again.
 *
 * A failed upload used to end the attempt: the file was gone from the input, the person was
 * told "it did not work", and the only way to recover was to open the file picker again and
 * remember what they had chosen. On a phone, after a dropped connection in a tunnel, that is
 * the moment people give up.
 *
 * The files are held in memory and never persisted: a photo from someone's camera roll should
 * not survive in browser storage after the tab closes, and the guarantee this offers is exactly
 * "while the page is open". Nothing here touches the network - it is a shelf, not a queue.
 */

/** The most files kept for a retry, so a repeated failure cannot grow without a limit. */
export const MAX_PENDING = 20;

export type PendingAttachment = {
  /** Stable identity for React keys and for "is this already on the shelf". */
  key: string;
  file: File;
  /** The conversation it was meant for: retrying into another chat would be surprising. */
  chatId: number | null;
  /** Whether the send was a view-once send, which must be retried the same way. */
  viewOnce: boolean;
  /** Why it failed, in the words the person was shown. */
  reason: string;
};

/**
 * Adds a failed file to the shelf.
 *
 * The newest failure is never dropped in favour of an older one: if the shelf is full, the
 * oldest entry goes. A person retrying after a network outage cares about the photo they just
 * sent, not the one from ten minutes ago.
 */
export function addPending(list: PendingAttachment[], entry: PendingAttachment): PendingAttachment[] {
  const withoutDuplicate = list.filter((item) => item.key !== entry.key);
  const next = [...withoutDuplicate, entry];
  return next.length > MAX_PENDING ? next.slice(next.length - MAX_PENDING) : next;
}

/** Removes one entry, by key. */
export function removePending(list: PendingAttachment[], key: string): PendingAttachment[] {
  return list.filter((item) => item.key !== key);
}

/**
 * The entries that belong to the conversation on screen.
 *
 * A file that failed in one chat is not offered in another: "retry" that sends a photo somewhere
 * the person was not looking would be worse than no retry at all.
 */
export function pendingForChat(list: PendingAttachment[], chatId: number | null): PendingAttachment[] {
  if (chatId === null) return [];
  return list.filter((item) => item.chatId === chatId);
}

/**
 * A short description for the button: the file name is the useful part, and a long one has to
 * be cut without pretending it is the whole name.
 */
export function pendingLabel(entry: PendingAttachment): string {
  const max = 24;
  const name = entry.file.name;
  return name.length <= max ? `Повторить «${name}»` : `Повторить «${name.slice(0, max - 1)}…»`;
}
