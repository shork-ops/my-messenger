/**
 * Catching up after the realtime connection was lost.
 *
 * A websocket drops for ordinary reasons - a tunnel, a laptop sleeping, a flaky network - and
 * while it is down the database keeps accepting messages. When the connection returns, the
 * subscription only reports what happens from that moment: everything written during the gap is
 * simply missing on this device, and nothing on screen says so. The conversation looks complete
 * and is not.
 *
 * The fix is a fetch of what was missed, merged by message id. Merging is where this can go
 * wrong in two opposite ways, so both are handled explicitly here and tested:
 *
 * - a message that arrived twice must not appear twice;
 * - a message that arrived while the fetch was in flight must not be lost by replacing the
 *   list with the server's copy.
 */

/** What a subscription tells us about its own health. */
export type ChannelStatus = "joined" | "lost" | "other";

/**
 * Whether a channel status means the connection is usable.
 *
 * `SUBSCRIBED` is the only status that means events are arriving. `CHANNEL_ERROR`,
 * `TIMED_OUT` and `CLOSED` all mean they are not - and all of them are recoverable, which is
 * why this returns a reason rather than a boolean.
 */
export function channelStatus(status: string | undefined): ChannelStatus {
  if (!status) return "other";
  if (status === "SUBSCRIBED") return "joined";
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") return "lost";
  return "other";
}

/**
 * Whether a `joined` status should be treated as a recovery.
 *
 * The first join of a fresh subscription is not a recovery: the conversation was just loaded,
 * and fetching it again would be work with no gap to fill. Every join after the first is.
 */
export function isRecovery(previous: ChannelStatus | null, next: ChannelStatus): boolean {
  return next === "joined" && previous !== null && previous !== "joined";
}

type Identified = { remoteId?: string | null; id: number };

/**
 * Merges a freshly fetched conversation into the one already on screen.
 *
 * The server copy wins for messages that exist in both, because it is the newer truth: an edit,
 * a reaction or a poll result that happened during the gap lives there. Messages present only
 * on screen are kept and stay in place - they arrived from the socket while the fetch was in
 * flight, and dropping them would recreate the very gap this is meant to close.
 *
 * Order is by id, ascending, which is the order the database assigns. That keeps the merge
 * stable no matter which side a message came from.
 */
export function mergeCatchUp<T extends Identified>(onScreen: T[], fetched: T[]): T[] {
  const merged = new Map<string, T>();

  const keyOf = (message: T) => (message.remoteId ? `r:${message.remoteId}` : `l:${message.id}`);

  for (const message of onScreen) merged.set(keyOf(message), message);
  for (const message of fetched) {
    // A fetched message replaces the on-screen copy of the same message: it carries the newer
    // body, reactions and poll state. It must not be appended as a second bubble.
    merged.set(keyOf(message), message);
  }

  return [...merged.values()].sort((a, b) => a.id - b.id);
}

/**
 * The window a catch-up has to cover: messages newer than the last one seen.
 *
 * Asking for the whole history after every reconnect would turn a brief network blip on a
 * five-thousand-message conversation into a full download on a phone. `null` means there is
 * nothing to anchor to, and the caller should fetch its usual first page.
 */
export function catchUpAfter(lastSeenId: number | null): number | null {
  if (lastSeenId === null || !Number.isFinite(lastSeenId)) return null;
  return lastSeenId;
}

/** How many catch-up attempts are allowed in a row before waiting for a real join. */
export const MAX_CATCH_UP_ATTEMPTS = 3;

/**
 * Whether to try again after a failed catch-up.
 *
 * A catch-up that fails (still offline, server error) should be retried - but not forever, and
 * not in a tight loop: a person watching a spinner is worse off than one who is told plainly
 * that the conversation may be out of date.
 */
export function shouldRetryCatchUp(attempts: number): boolean {
  return attempts < MAX_CATCH_UP_ATTEMPTS;
}

/** A sentence for the reader, saying what is actually known rather than "syncing". */
export function catchUpLabel(state: "idle" | "catching" | "failed"): string | null {
  if (state === "catching") return "Догоняю пропущенные сообщения…";
  if (state === "failed") return "Часть сообщений могла не загрузиться: потяните, чтобы обновить";
  return null;
}
