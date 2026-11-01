/**
 * Softening a shouted message, and saying how hot it was.
 *
 * Loaded with the «Анти-ссора» sheet only. The rules are conservative on purpose: the
 * result is offered for the person to read before anything is sent, but it should still need
 * no fixing in the ordinary case.
 *
 * - Capitals become lower case where they are shouting: a run of capital words, or one long
 *   word. A short capital word standing alone - «США», «ОК», «МФЦ» - is an abbreviation and
 *   stays. A changed word that opens a sentence gets its capital letter back.
 * - «!!!», «???» and «?!?!» become one mark; «!!!111» too.
 * - Stretched letters - «нееет», «ну дааааа» - are put back to one.
 * - Angry faces become a puzzled one. Code, links and @mentions are not touched at all.
 */

import { PROTECTED, isCapsWord, prose } from "./coolDown";

export const NORMAL_TEMPERATURE = 36.6;
export const MAX_TEMPERATURE = 99.9;

const WORD = /\p{L}+/gu;
const STRETCHED = /(\p{L})\1{2,}/giu;
const MARKS = /[!?]{2,}1*|!1+/g;
const ANGRY = /\u{1F92C}|\u{1F621}|\u{1F47F}|\u{1F4A2}|\u{1F620}|\u{1F595}\p{EMod}?/gu;
const MIDDLE_FINGER = /^\u{1F595}/u;
/** Words of this length or longer are shouting even on their own. */
const LONG_WORD = 5;

/** True for an upper-case single letter that can be lowered: «Я», «В», «А» - but not «I». */
function isCapsLetter(word: string): boolean {
  return word.length === 1 && word !== "I" && word === word.toUpperCase() && word !== word.toLowerCase();
}

type Token = { start: number; end: number; word: string };

function coolProse(piece: string, sentenceStart: (offset: number, sofar: string) => boolean): string {
  const unstretched = piece.replace(STRETCHED, "$1");
  const tokens: Token[] = [...unstretched.matchAll(WORD)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    word: match[0],
  }));

  // Which words to lower. Long capital words always; short ones only next to another
  // capital word, since that is a raised voice and not an abbreviation.
  const lower = tokens.map(() => false);
  const caps = tokens.map((token) => isCapsWord(token.word));
  const neighbourCaps = (index: number, step: -1 | 1) => {
    for (let at = index + step; at >= 0 && at < tokens.length; at += step) {
      // «Я», «В» inside a shouted run are part of it; a lower-case «и» or «в» is calm
      // speech between two abbreviations - «США и ЕС» - and ends the run.
      if (isCapsLetter(tokens[at].word)) continue;
      return caps[at];
    }
    return false;
  };
  tokens.forEach((token, index) => {
    if (caps[index]) {
      lower[index] = token.word.length >= LONG_WORD || neighbourCaps(index, -1) || neighbourCaps(index, 1);
    } else if (isCapsLetter(token.word)) {
      lower[index] = neighbourCaps(index, -1) || neighbourCaps(index, 1);
    }
  });

  let out = "";
  let cursor = 0;
  tokens.forEach((token, index) => {
    out += unstretched.slice(cursor, token.start);
    let word = token.word;
    if (lower[index]) {
      word = word.toLowerCase();
      if (sentenceStart(token.start, out)) word = word.charAt(0).toUpperCase() + word.slice(1);
    }
    out += word;
    cursor = token.end;
  });
  out += unstretched.slice(cursor);

  return out
    .replace(MARKS, (marks) => {
      const bang = marks.includes("!");
      const question = marks.includes("?");
      return bang && question ? "?!" : question ? "?" : "!";
    })
    .replace(ANGRY, (face) => (MIDDLE_FINGER.test(face) ? "" : "\u{1F615}"))
    .replace(/[ \t]{2,}/g, " ");
}

const SENTENCE_END = /(?:^|[.!?…]["»”)]*\s+|\n\s*)$/;

/** The same message, said without shouting. */
export function coolText(text: string): string {
  let out = "";
  let cursor = 0;
  const cool = (piece: string) => {
    const before = out;
    out += coolProse(piece, (_offset, sofar) => SENTENCE_END.test(before + sofar));
  };
  for (const match of text.matchAll(PROTECTED)) {
    const at = match.index ?? 0;
    cool(text.slice(cursor, at));
    out += match[0];
    cursor = at + match[0].length;
  }
  cool(text.slice(cursor));
  return out.trim();
}

/**
 * How heated a message reads, from 36,6° for a calm one to 99,9°.
 *
 * Not a measurement of anything real - a playful number to make the point visible: the share
 * of words in capitals carries the most, then the count of them, then «!!!», stretched letters
 * and angry faces.
 */
export function temperature(text: string): number {
  const plain = prose(text);
  const words = [...plain.matchAll(WORD)].map((match) => match[0]).filter((word) => word.length >= 2);
  const caps = words.filter(isCapsWord).length;
  const share = words.length ? caps / words.length : 0;
  const marks = (plain.match(/[!]/g)?.length ?? 0) + Math.max(0, (plain.match(/\?/g)?.length ?? 0) - 1);
  const stretched = plain.match(STRETCHED)?.length ?? 0;
  const angry = plain.match(ANGRY)?.length ?? 0;
  const heat =
    NORMAL_TEMPERATURE +
    share * 38 +
    Math.min(caps, 10) * 1.2 +
    Math.min(marks, 10) * 2 +
    Math.min(stretched, 5) * 2 +
    Math.min(angry, 5) * 4;
  return Math.round(Math.min(MAX_TEMPERATURE, heat) * 10) / 10;
}

/** «36,6°» near normal, «87°» when hot: the decimal matters only where it is the joke. */
export function formatDegrees(value: number): string {
  if (value < 40) return `${value.toFixed(1).replace(".", ",")}°`;
  return `${Math.round(value)}°`;
}

/** Where the needle sits on the scale, 0 to 1. */
export function scalePosition(value: number): number {
  const span = MAX_TEMPERATURE - NORMAL_TEMPERATURE;
  return Math.max(0, Math.min(1, (value - NORMAL_TEMPERATURE) / span));
}

/** The sheet's heading, by how hot it is. */
export function heatTitle(value: number): { icon: string; title: string } {
  if (value >= 85) return { icon: "🌋", title: "Сообщение раскалено" };
  if (value >= 65) return { icon: "♨️", title: "Кажется, тут кипит" };
  return { icon: "📢", title: "Слишком громко?" };
}
