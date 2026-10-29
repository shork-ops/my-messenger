/**
 * The "about" line on a profile.
 *
 * Kept small and pure so the trimming rules are testable: users paste text with
 * stray newlines and trailing spaces, and a card that renders those literally
 * looks broken.
 */

/** Same limit as the database constraint. */
export const ABOUT_MAX = 140;

/**
 * Cleans a typed value into what will be stored.
 *
 * Collapses runs of blank lines, trims each line, and trims the whole thing, so a
 * paste from a document behaves like something typed by hand.
 *
 * Cutting happens by code point, not by UTF-16 unit: String.slice would happily
 * split an emoji down the middle and leave a replacement character behind.
 */
export function normalizeAbout(input: string): string {
  const cleaned = input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, all) => !(line === "" && (index === 0 || index === all.length - 1)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return Array.from(cleaned).slice(0, ABOUT_MAX).join("");
}

/** Characters left before the limit. Never negative. */
export function aboutRemaining(input: string): number {
  return Math.max(0, ABOUT_MAX - Array.from(input).length);
}

/**
 * Whether to show the counter. Shown only once the user is close to the limit,
 * so the field stays quiet while it is not a concern.
 */
export function shouldShowAboutCounter(input: string): boolean {
  return Array.from(input).length >= ABOUT_MAX - 30;
}

/** Short line for the profile card; null when there is nothing worth showing. */
export function aboutForCard(about: string | null | undefined): string | null {
  const value = normalizeAbout(about ?? "");
  return value.length > 0 ? value : null;
}
