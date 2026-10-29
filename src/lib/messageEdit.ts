/**
 * Message editing and deletion rules.
 *
 * Kept pure so the edge cases have names: who may do what, what counts as a real
 * edit, and how a deleted message is presented.
 */

/** How long after sending a message may still be edited. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** How long a "deleted for everyone" message keeps its original text in storage. */
export const SOFT_DELETE_GRACE_MS = 15 * 60 * 1000;

export const EDITED_LABEL = "изменено";
export const DELETED_LABEL = "Сообщение удалено";

/**
 * Whether the edit controls should be offered.
 *
 * Only the author may edit, and only inside the window - a chat where anyone can
 * rewrite history at any time is not a chat, it is a document with no versions.
 */
export function canEdit(message: { senderId: string; createdAt: number; deleted?: boolean; text: string }, viewerId: string, now: number): boolean {
  if (message.deleted) return false;
  if (message.senderId !== viewerId) return false;
  if (!message.text.trim()) return false;
  return now - message.createdAt <= EDIT_WINDOW_MS;
}

/** Whether the author may still remove the message for everyone. */
export function canDeleteForEveryone(message: { senderId: string; createdAt: number; deleted?: boolean }, viewerId: string, now: number): boolean {
  if (message.deleted) return false;
  if (message.senderId !== viewerId) return false;
  return now - message.createdAt <= EDIT_WINDOW_MS;
}

/**
 * Whether saving the draft would actually change anything.
 *
 * Compared after trimming and collapsing whitespace, so adding a trailing space
 * does not earn an "edited" mark.
 */
export function isRealEdit(original: string, draft: string): boolean {
  const norm = (value: string) => value.replace(/\s+/g, " ").trim();
  return norm(original) !== norm(draft) && norm(draft).length > 0;
}

/** "изменено" only after a successful edit; null when the message is untouched. */
export function editedLabel(editedAt: number | null | undefined): string | null {
  return editedAt ? EDITED_LABEL : null;
}

/**
 * What a reader sees in place of a removed message.
 *
 * Removes the text but keeps the slot, so the conversation around it still reads
 * in order. "У себя" leaves nothing at all: the row is gone from that one client.
 */
export function deletedPlaceholder(): string {
  return DELETED_LABEL;
}

/**
 * Whether the stored text may be wiped yet.
 *
 * A grace period lets the author undo a mistaken delete; after it, the text is
 * cleared for good rather than lingering as a soft-deleted row nobody can see.
 */
export function mayPurgeText(deletedAt: number | null | undefined, now: number): boolean {
  if (!deletedAt) return false;
  return now - deletedAt >= SOFT_DELETE_GRACE_MS;
}

/** How long an undo stays available, in seconds, for the snackbar copy. */
export function undoSeconds(now: number, deletedAt: number): number {
  return Math.max(0, Math.ceil((SOFT_DELETE_GRACE_MS - (now - deletedAt)) / 1000));
}
