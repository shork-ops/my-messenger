/**
 * How many emoji a message is made of, when it is made of nothing else.
 *
 * A lone "👍" or "😂😂" is a reaction typed as a message, and every large messenger draws it
 * large and without a bubble: in a bubble at body size it is a speck next to its own time.
 * Up to three count; a fourth, or any letter, digit or punctuation, makes it ordinary text.
 */
export const BIG_EMOJI_MAX = 3;

const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
const NOT_EMOJI = /[\p{L}\p{N}\p{P}]/u;

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
type SegmenterCtor = new (locale?: string, options?: { granularity: "grapheme" }) => Segmenter;

export function emojiOnlyCount(text: string): number {
  const trimmed = text.trim();
  // Long text cannot be three emoji, and a short cut keeps the check off long messages.
  if (!trimmed || trimmed.length > 48) return 0;
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (!Ctor) return 0;
  let count = 0;
  for (const { segment } of new Ctor(undefined, { granularity: "grapheme" }).segment(trimmed)) {
    if (!segment.trim()) continue;
    if (!PICTURE.test(segment) || NOT_EMOJI.test(segment.replace(/[#*0-9]\uFE0F?\u20E3/gu, ""))) return 0;
    count += 1;
    if (count > BIG_EMOJI_MAX) return 0;
  }
  return count;
}
