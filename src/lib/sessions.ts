/**
 * Session list and passcode.
 *
 * Supabase does not expose the list of signed-in devices to the client, so the app
 * keeps its own short record per device. The record is a hint for the person
 * reading it, not a security boundary: the only action it enables is "sign out
 * everywhere else", which the server performs for real.
 */

/** One device, as this browser remembers it. */
export type SessionRecord = {
  /** Identifies the device row; the local one is compared against it. */
  deviceId: string;
  label: string;
  platform: string;
  lastSeen: number;
};

export const SESSION_STORAGE_KEY = "nexus-devices";

/**
 * A short human description of the current device.
 *
 * Naming the browser helps someone recognise "this is the phone" without reading a
 * user-agent string.
 */
export function describeDevice(userAgent: string): { label: string; platform: string } {
  const ua = userAgent.toLowerCase();
  const platform = /android/.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/.test(ua)
      ? "iOS"
      : /windows/.test(ua)
        ? "Windows"
        : /mac os/.test(ua)
          ? "macOS"
          : /linux/.test(ua)
            ? "Linux"
            : "Неизвестно";
  const label = /yabrowser/.test(ua)
    ? "Яндекс Браузер"
    : /edg\//.test(ua)
      ? "Edge"
      : /chrome|crios/.test(ua)
        ? "Chrome"
        : /firefox|fxios/.test(ua)
          ? "Firefox"
          : /safari/.test(ua)
            ? "Safari"
            : "Браузер";
  return { label, platform };
}

/** Remembers the current device and drops records older than a month. */
export function upsertSession(sessions: SessionRecord[], record: SessionRecord, now: number): SessionRecord[] {
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const kept = sessions.filter((item) => item.deviceId !== record.deviceId && item.lastSeen >= monthAgo);
  return [record, ...kept];
}

/** Where the last-seen value is worth showing as text. */
export function lastSeenLabel(lastSeen: number, now: number): string {
  const minutes = Math.floor((now - lastSeen) / 60000);
  if (minutes < 1) return "Сейчас";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

/** Four digits: enough to keep a casual borrower out, short enough to type. */
export const PASSCODE_LENGTH = 4;

/** A stored passcode is never shown back, only checked. */
export function isValidPasscode(value: string): boolean {
  return /^\d{4}$/.test(value);
}

/**
 * Compares without leaking how much matched.
 *
 * A plain === returns as soon as a digit differs, which is measurable over enough
 * attempts. The comparison always walks the whole string.
 */
export function passcodeMatches(stored: string | null, entered: string): boolean {
  if (!stored || !isValidPasscode(entered)) return false;
  let difference = 0;
  for (let index = 0; index < stored.length; index += 1) {
    difference |= stored.charCodeAt(index) ^ entered.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Whether to show the lock screen.
 *
 * Only when a passcode exists and this session has not been unlocked yet: asking a
 * person who never set one to unlock the app would be a trap.
 */
export function shouldLock(passcodeEnabled: boolean, unlocked: boolean): boolean {
  return passcodeEnabled && !unlocked;
}

export const PASSCODE_STORAGE_KEY = "nexus-passcode";
