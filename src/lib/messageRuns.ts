import type { Message } from "../types";

/** How long a run of messages from one person may pause before it reads as a new one. */
export const RUN_GAP_MS = 5 * 60 * 1000;

/**
 * How each message relates to its neighbour, the way a chat groups consecutive messages.
 *
 * Telegram, and every messenger that followed it, names the speaker once at the top of a
 * run rather than above every line. Repeating "Максим" above eight messages in a row adds
 * eight identical lines and tells the reader nothing after the first.
 *
 * A run is broken when the author changes, when the day changes, and when enough time
 * passes that the messages were not written in one go. The last one matters: without it a
 * conversation that paused for an hour would look like one breath, and the name would
 * appear far from some of the messages it labels.
 *
 * Pure so it can be tested without rendering: the grouping decision is the whole feature,
 * and the component only paints it.
 */
export function messageRuns(messages: Message[], gapMs: number = RUN_GAP_MS): {
  /** First of a run: carries the name. */
  startsRun: boolean[];
  /** Last of a run: the tail of the bubble is rounded, so the run reads as one block. */
  endsRun: boolean[];
  /** Whether this message continues the one above it from the same author. */
  continues: boolean[];
} {
  const startsRun: boolean[] = [];
  const endsRun: boolean[] = [];
  const continues: boolean[] = [];

  const authorOf = (message: Message) => (message.mine ? "__self__" : message.author);
  const dayOf = (message: Message) => {
    if (!message.createdAt) return null;
    const date = new Date(message.createdAt);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  messages.forEach((message, index) => {
    const previous = index > 0 ? messages[index - 1] : null;
    const joinedWithPrevious = Boolean(
      previous &&
        authorOf(previous) === authorOf(message) &&
        dayOf(previous) === dayOf(message) &&
        // Without timestamps there is nothing to compare, so the authors decide.
        (!previous.createdAt || !message.createdAt || message.createdAt - previous.createdAt <= gapMs)
    );
    continues.push(joinedWithPrevious);
    startsRun.push(previous ? !joinedWithPrevious : true);
  });

  messages.forEach((_message, index) => {
    const next = index + 1 < messages.length ? messages[index + 1] : null;
    endsRun.push(next ? !continues[index + 1] : true);
  });

  return { startsRun, endsRun, continues };
}
