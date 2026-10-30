/**
 * What other people are allowed to learn about the reader.
 *
 * These are reads, not writes. Switching receipts off stops *this* browser from rendering
 * the ticks; it cannot stop the other side's phone from recording that a message was
 * delivered. Saying that plainly matters more than the feature: a settings screen that
 * implies "they will never know you read it" would be a lie this app cannot back up.
 */

export type PrivacyPrefs = {
  /** Blue double ticks on your own messages. */
  readReceipts: boolean;
  /** The "last seen" line above the conversation for the other person. */
  lastSeen: boolean;
  /** Whether your typing is announced to the other side. */
  typingIndicator: boolean;
};

export const DEFAULT_PRIVACY: PrivacyPrefs = {
  readReceipts: true,
  lastSeen: true,
  typingIndicator: true,
};

const FIELDS = Object.keys(DEFAULT_PRIVACY) as (keyof PrivacyPrefs)[];

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Reads stored preferences, falling back per field rather than discarding the whole value. */
export function parsePrivacy(raw: string | null): PrivacyPrefs {
  if (!raw) return DEFAULT_PRIVACY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PRIVACY;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_PRIVACY;

  // A field stored by an older build may be missing; the default covers it. A field of the
  // wrong type is ignored for the same reason - guessing "нет" into `true` would silently
  // turn notifications of privacy back on.
  const result: PrivacyPrefs = { ...DEFAULT_PRIVACY };
  for (const field of FIELDS) {
    const value = (parsed as Record<string, unknown>)[field];
    if (isBoolean(value)) result[field] = value;
  }
  return result;
}

export function serializePrivacy(prefs: PrivacyPrefs): string {
  const ordered: Partial<PrivacyPrefs> = {};
  for (const field of FIELDS) ordered[field] = prefs[field];
  return JSON.stringify(ordered);
}

/**
 * What to show for a message the other side has read.
 *
 * Null means "show nothing", which is different from "show that it is unread": a disabled
 * receipt must not look like a receipt that has not arrived yet.
 */
export function receiptVisible(receipt: "sent" | "read" | null, enabled: boolean): "sent" | "read" | null {
  return enabled ? receipt : null;
}

/** The last-seen line, or nothing when it is switched off. */
export function seenVisible(label: string | null, enabled: boolean): string | null {
  if (!enabled) return null;
  return label;
}
