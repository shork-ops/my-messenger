/**
 * The colour of a letter avatar.
 *
 * Every cloud chat used to arrive as "blue", so a list of ten people was ten identical grey
 * circles and the letter was the only thing telling them apart. Telegram, WhatsApp and Signal
 * all give each person a colour of their own, picked from the account rather than chosen by
 * hand, so it is the same on every device and the same in the list, the header and the group.
 */
export const AVATAR_TONES = ["red", "orange", "violet", "green", "teal", "blue", "pink"] as const;

export type AvatarTone = (typeof AVATAR_TONES)[number];

/** A stable colour for an id or a name: the same seed always gives the same colour. */
export function avatarTone(seed: string): AvatarTone {
  // FNV-1a: short, fast and spreads neighbouring ids across the palette.
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_TONES[(hash >>> 0) % AVATAR_TONES.length];
}
