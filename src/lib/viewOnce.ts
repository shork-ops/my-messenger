/**
 * Media that can be looked at once.
 *
 * Two honest limits decide the design.
 *
 * The first: a browser cannot stop a screenshot. It can notice one in a narrow case (the
 * visibility change when the system screenshot UI covers the tab), and it cannot be trusted to.
 * So there is no "screenshot detected!" alarm - there is a notice that this kind of media is
 * meant to be seen once, shown before it is opened, and a statement afterwards that it is gone.
 *
 * The second: "deleted after viewing" has to mean something. Since the bytes are fetched by
 * the client, the only real deletion is the sender's blob and the copy on screen; a viewer who
 * saved the file with the developer console has it. The promise made in the interface is what
 * is true: the message is removed from the conversation and cannot be opened again.
 */

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

/**
 * Which single-view media has already been opened.
 *
 * Kept in the browser rather than in the message row, because the row belongs to the sender
 * too and this is a fact about the reader. In memory, a component that is unmounted when the
 * reader switches to another chat comes back believing the photo is still unopened - which is
 * exactly the failure that makes the promise meaningless.
 *
 * The honest limit: a different device, or cleared storage, starts over. Since the picture is
 * fetched by the client, that was never a guarantee a server could keep either.
 */
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
