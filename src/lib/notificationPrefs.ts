/**
 * When and how to notify.
 *
 * Kept pure: the decisions here are the ones people complain about when they are
 * wrong - a phone that buzzes at three in the morning, or a message that arrives
 * silently because a quiet window was computed in the wrong time zone.
 */

export type QuietHours = {
  enabled: boolean;
  /** Minutes after local midnight, inclusive. */
  fromMinute: number;
  /** Minutes after local midnight, exclusive; may be earlier than `fromMinute`. */
  toMinute: number;
};

export type NotificationPrefs = {
  sound: boolean;
  vibration: boolean;
  quiet: QuietHours;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  sound: true,
  vibration: true,
  // A quiet window that covers a normal night, off until the user asks for it.
  quiet: { enabled: false, fromMinute: 22 * 60, toMinute: 8 * 60 },
};

/** Minutes after local midnight for a Date, in the device's own time zone. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Whether `now` falls inside the quiet window.
 *
 * The window usually wraps midnight (22:00 to 08:00), so the comparison cannot be
 * a simple `from <= now < to`.
 */
export function inQuietHours(quiet: QuietHours, now: Date): boolean {
  if (!quiet.enabled) return false;
  const minute = minutesOfDay(now);
  const { fromMinute, toMinute } = quiet;
  if (fromMinute === toMinute) return false;
  if (fromMinute < toMinute) return minute >= fromMinute && minute < toMinute;
  // Wraps midnight.
  return minute >= fromMinute || minute < toMinute;
}

/** Whether a message arriving now should make noise. */
export function shouldPlaySound(prefs: NotificationPrefs, now: Date): boolean {
  return prefs.sound && !inQuietHours(prefs.quiet, now);
}

/** Quiet hours silence sound and vibration, but never the notification itself. */
export function shouldVibrate(prefs: NotificationPrefs, now: Date): boolean {
  return prefs.vibration && !inQuietHours(prefs.quiet, now);
}

/** "22:00" from 1320 - for showing the window back to the user. */
export function formatMinute(minute: number): string {
  const wrapped = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "22:00" back to 1320; null when the text is not a valid time. */
export function parseMinute(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Two short pulses: the pattern most messengers use for an incoming message. */
export const VIBRATION_PATTERN = [60, 40, 60];

/**
 * Preferences are stored as one string so a schema change needs no migration.
 *
 * Anything unreadable falls back to the defaults rather than to silence: a person
 * who cannot load their settings should still be told that a message arrived.
 */
export function serializePrefs(prefs: NotificationPrefs): string {
  return JSON.stringify(prefs);
}

export function parsePrefs(raw: string | null | undefined): NotificationPrefs {
  if (!raw) return DEFAULT_NOTIFICATION_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      sound: typeof value.sound === "boolean" ? value.sound : DEFAULT_NOTIFICATION_PREFS.sound,
      vibration: typeof value.vibration === "boolean" ? value.vibration : DEFAULT_NOTIFICATION_PREFS.vibration,
      quiet: {
        enabled: Boolean(value.quiet?.enabled),
        fromMinute:
          typeof value.quiet?.fromMinute === "number" ? value.quiet.fromMinute : DEFAULT_NOTIFICATION_PREFS.quiet.fromMinute,
        toMinute: typeof value.quiet?.toMinute === "number" ? value.quiet.toMinute : DEFAULT_NOTIFICATION_PREFS.quiet.toMinute,
      },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}
