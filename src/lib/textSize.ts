/**
 * Text size.
 *
 * Three steps rather than a slider: a continuous scale invites values nobody
 * tested, and the layout only has to survive three.
 */

export const TEXT_SIZES = [
  { id: "s", label: "Мелкий", scale: 0.9 },
  { id: "m", label: "Средний", scale: 1 },
  { id: "l", label: "Крупный", scale: 1.15 },
] as const;

export type TextSizeId = (typeof TEXT_SIZES)[number]["id"];

export const DEFAULT_TEXT_SIZE: TextSizeId = "m";

/** Unknown or missing values fall back to the default rather than a broken scale. */
export function resolveTextSize(id: string | null | undefined): (typeof TEXT_SIZES)[number] {
  return TEXT_SIZES.find((size) => size.id === id) ?? TEXT_SIZES[1];
}

/**
 * The scale for a stored value.
 *
 * Only the message text and its neighbours grow: chrome that is already tight
 * (badges, timestamps) is laid out in fixed pixels, and scaling it would push
 * the composer off a phone screen.
 */
export function textScaleCss(id: string | null | undefined): string {
  return `--text-scale: ${resolveTextSize(id).scale};`;
}
