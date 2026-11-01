/**
 * Hidden messages: the text arrives covered with moving dust and opens on a tap, as in
 * Telegram.
 *
 * A hidden message is an ordinary message whose whole body is one spoiler, `||like this||`.
 * Keeping the mark in the text rather than in a new column means it survives every path a
 * message already takes - the outbox, a reload, a forward, another device, an older build of
 * this app, which shows it as a spoiler - and needs nothing from the database.
 */

const MARK = "||";

/** What a list, a notification or a quote says instead of the text. */
export const HIDDEN_LABEL = "Скрытое сообщение";

/** What an inline spoiler becomes in one line of preview. */
export const SPOILER_MASK = "▒▒▒";

/** The pipe that a word joiner keeps from pairing with the next one. */
const JOINED_PIPE = /\|\u2060(?=\|)/g;

/** Wraps a draft so that it is sent hidden. */
export function hideText(text: string): string {
  // A pair of pipes inside would close the cover early and show the rest. A word joiner
  // after each pipe that has a pipe behind it keeps them looking the same and stops them
  // reading as a marker.
  return MARK + text.replace(/\|(?=\|)/g, "|\u2060") + MARK;
}

/** True when the whole message is one hidden block. */
export function isHidden(text: string): boolean {
  if (text.length <= MARK.length * 2 || !text.startsWith(MARK) || !text.endsWith(MARK)) return false;
  const inner = text.slice(MARK.length, -MARK.length);
  return inner.trim() !== "" && !inner.includes(MARK);
}

/** The text under the cover, as the sender typed it. */
export function hiddenBody(text: string): string {
  if (!isHidden(text)) return text;
  return text.slice(MARK.length, -MARK.length).replace(JOINED_PIPE, "|");
}

/**
 * One line of preview that gives nothing away: a hidden message is named, not quoted, and
 * each inline spoiler becomes a bar.
 *
 * `truncated` is for a body that was cut to length on the way (push payloads are): a cover
 * that opened and never closed then hides everything after it, because the end it would
 * have had is exactly what was cut.
 */
export function maskSpoilers(text: string, options: { truncated?: boolean } = {}): string {
  if (!text.includes(MARK)) return text;
  if (isHidden(text)) return HIDDEN_LABEL;
  if (options.truncated && text.startsWith(MARK) && !text.includes(MARK, MARK.length)) return HIDDEN_LABEL;
  const masked = text.replace(/\|\|(?=\S)[\s\S]*?\|\|/g, SPOILER_MASK);
  return options.truncated ? masked.replace(/\|\|[\s\S]*$/, SPOILER_MASK) : masked;
}
