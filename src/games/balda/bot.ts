/**
 * The «Балда» bot.
 *
 * Unlike chess there is nothing to search: the board is 25 squares and the words are in a
 * dictionary, so the bot's job is to find the words a human could find and pick one. That
 * makes it easy to get wrong in a specific way - a bot that enumerates every path over every
 * letter is slow enough to freeze a phone, and one that scores only by length always plays the
 * same longest word and is boring to lose to.
 */

import { makeRandom } from "../core/types";
import { allLegalWords, type Board, type BaldaState } from "./engine";
import { normalise } from "./dictionary";

export type BaldaDifficulty = "easy" | "normal";

/** The bot's choice: a word, where to put its first letter, and the path that spells it. */
export type BaldaMove = { word: string; square: number; letter: string };

/**
 * Picks a move.
 *
 * The easy level deliberately does not always choose the longest word: it takes a random pick
 * among the shorter half of what it found, so a beginner can win. The normal level always takes
 * the best score it can find.
 */
export function chooseBaldaMove(
  state: BaldaState,
  difficulty: BaldaDifficulty = "normal",
  random: () => number = makeRandom(state.seed)
): BaldaMove | null {
  if (state.result) return null;
  const candidates = allLegalWords(state.board, state.usedWords);
  if (candidates.length === 0) return null;

  const sorted = candidates.slice().sort((a, b) => b.word.length - a.word.length);

  if (difficulty === "easy") {
    // Take from the shorter half. A bot that always plays the longest word is not a beginner.
    const half = Math.max(1, Math.ceil(sorted.length / 2));
    const pool = sorted.slice(half - 1);
    return pool[Math.floor(random() * pool.length)] ?? sorted[0];
  }

  // The best score, with a random pick among ties so two games with the same seed differ
  // only where the board allows it.
  const best = sorted[0].word.length;
  const ties = sorted.filter((move) => move.word.length === best);
  return ties[Math.floor(random() * ties.length)] ?? sorted[0];
}

/**
 * Every letter the bot could place, for the interface's hint button.
 *
 * Bounded on purpose: the full enumeration is used to build the word list, and a hint that
 * takes a second to appear is not a hint.
 */
export function hintsFor(state: BaldaState, limit = 5): BaldaMove[] {
  const candidates = allLegalWords(state.board, state.usedWords);
  return candidates
    .slice()
    .sort((a, b) => b.word.length - a.word.length)
    .slice(0, limit);
}

/** Whether a word would be a legal move, used by tests and by the interface before sending. */
export function checkWord(state: BaldaState, square: number, letter: string, word: string): string | null {
  const found = allLegalWords(state.board, state.usedWords).find(
    (move) => move.square === square && normalise(word) === move.word
  );
  return found ? null : "Такого слова на поле не получается";
}

export function describeMove(move: BaldaMove): string {
  return `${move.word.toLocaleUpperCase("ru-RU")} (+${move.word.length})`;
}

export type { Board };
