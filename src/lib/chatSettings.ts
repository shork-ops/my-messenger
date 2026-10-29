/**
 * Muting a chat.
 *
 * "Muted" is a duration, not a flag: "until this evening" is a different promise
 * from "until I say otherwise", and a boolean cannot express either.
 */

export const MUTE_OPTIONS = [
  { id: "1h", label: "На 1 час", minutes: 60 },
  { id: "8h", label: "На 8 часов", minutes: 8 * 60 },
  { id: "1w", label: "На неделю", minutes: 7 * 24 * 60 },
  { id: "forever", label: "Навсегда", minutes: null },
] as const;

export type MuteOptionId = (typeof MUTE_OPTIONS)[number]["id"];

/** A mute that never expires. Far enough away to outlive any session. */
export const MUTE_FOREVER = new Date("9999-12-31T00:00:00Z");

/** The moment a mute ends, or null for "not muted". */
export function muteUntil(optionId: MuteOptionId, now: Date): Date | null {
  const option = MUTE_OPTIONS.find((item) => item.id === optionId);
  if (!option) return null;
  if (option.minutes === null) return MUTE_FOREVER;
  return new Date(now.getTime() + option.minutes * 60 * 1000);
}

/**
 * Whether notifications for this chat are suppressed right now.
 *
 * Compared against the clock rather than a stored flag, so a mute set for an hour
 * expires on its own even if nothing is open to clear it.
 */
export function isMuted(mutedUntil: Date | number | null | undefined, now: Date): boolean {
  if (mutedUntil === null || mutedUntil === undefined) return false;
  const until = mutedUntil instanceof Date ? mutedUntil.getTime() : mutedUntil;
  return until > now.getTime();
}

/** The shortest remaining mute that still counts as "forever", for the label. */
export function isMutedForever(mutedUntil: Date | number | null | undefined): boolean {
  if (mutedUntil === null || mutedUntil === undefined) return false;
  const until = mutedUntil instanceof Date ? mutedUntil.getTime() : mutedUntil;
  return until >= MUTE_FOREVER.getTime();
}

/**
 * What the chat list shows for a muted chat.
 *
 * Time left rather than the wall-clock end: "осталось 40 мин" answers the question
 * a person actually has, which is "when will it be noisy again".
 */
export function muteLabel(mutedUntil: Date | number | null | undefined, now: Date): string | null {
  if (!isMuted(mutedUntil, now)) return null;
  if (isMutedForever(mutedUntil)) return "Без звука";
  const until = mutedUntil instanceof Date ? mutedUntil.getTime() : Number(mutedUntil);
  const minutesLeft = Math.ceil((until - now.getTime()) / 60000);
  if (minutesLeft <= 60) return `Без звука ${minutesLeft} мин`;
  const hoursLeft = Math.ceil(minutesLeft / 60);
  if (hoursLeft < 24) return `Без звука ${hoursLeft} ч`;
  return `Без звука ${Math.ceil(hoursLeft / 24)} дн`;
}

/** Whether a row belongs in the archive rather than the main list. */
export function isArchived(archivedAt: Date | number | null | undefined): boolean {
  if (archivedAt === null || archivedAt === undefined) return false;
  const value = archivedAt instanceof Date ? archivedAt.getTime() : archivedAt;
  return value > 0;
}

/**
 * Counts unread that still deserve attention.
 *
 * A muted chat keeps counting in its own row but is left out of the total: a badge
 * that includes chats you silenced on purpose trains people to ignore the badge.
 */
export function attentionTotal(chats: { unread?: number; mutedUntil?: Date | number | null; archived?: boolean }[], now: Date): number {
  return chats.reduce((sum, chat) => {
    if (chat.archived) return sum;
    if (isMuted(chat.mutedUntil, now)) return sum;
    return sum + (chat.unread ?? 0);
  }, 0);
}
