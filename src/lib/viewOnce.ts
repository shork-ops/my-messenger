/** Single-view UI helpers. Cloud media is claimed through viewOnceCloud and a server receipt.
 * Browser storage below is only a local UI/demo hint; it is never the cloud access control. */

/** A message whose attachment is marked single-view. */
export const VIEW_ONCE_KEY = "viewOnce";

/** How long the opened media is shown before it is withdrawn, in milliseconds. */
export const VIEW_ONCE_SECONDS = 10;

export type ViewOnceState = "closed" | "open" | "spent";

/** Whether this attachment should be treated as single-view at all. */
export function isViewOnce(extra: Record<string, unknown> | null | undefined): boolean {
  return Boolean(extra && extra[VIEW_ONCE_KEY] === true);
}

/** The wording shown before the media is opened - what the sender expects of the receiver. */
export function viewOnceWarning(): string {
  return "Фото исчезнет через 10 секунд после открытия. Открыть его можно только один раз.";
}

/** The wording shown after the media is withdrawn. */
export function viewOnceSpentLabel(): string {
  return "Открыто. Фото больше нельзя посмотреть.";
}

/**
 * The state after the media has been opened: it stays visible for `seconds`, then is spent.
 *
 * Returned as a pair rather than as a timer so the countdown can be rendered: a countdown that
 * is not shown makes the withdrawal look like a bug.
 */
export function nextViewOnceState(current: ViewOnceState): ViewOnceState {
  if (current === "closed") return "open";
  if (current === "open") return "spent";
  return "spent";
}

/** What is left of the countdown, given how much time has passed. Never negative. */
export function remainingSeconds(startedAt: number, now: number, seconds = VIEW_ONCE_SECONDS): number {
  const left = seconds - Math.floor((now - startedAt) / 1000);
  return Math.max(0, left);
}

/**
 * Whether the media should still be painted.
 *
 * Spent media must never come back: reopening the conversation, reloading the page, a React
 * re-render - none of them restore it. That is the whole feature.
 */
export function viewOnceVisible(state: ViewOnceState): boolean {
  return state === "open";
}

/** Local UI/demo hint. Real cloud access is enforced by the server per account/message. */
const SPENT_KEY = "nexus-view-once-spent";

function readSpent(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SPENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

/** Whether this piece of media has been opened already on this device. */
export function isSpent(key: string): boolean {
  return readSpent().has(key);
}

/** Remembers that it has been opened, so it is not shown again. */
export function markSpent(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const spent = readSpent();
    spent.add(key);
    window.localStorage.setItem(SPENT_KEY, JSON.stringify(Array.from(spent).slice(-500)));
  } catch {
    // Storage can be refused; the picture still closes, it just may be reopened later.
  }
}
