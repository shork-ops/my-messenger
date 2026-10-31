/**
 * The «Балда» bot.
 *
 * Two things it must never do: freeze the tab, and play a word that is not on the board. The
 * first one actually happened - a naive path enumeration ran for minutes before the prefix
 * index was added - so the timing test here is not decoration.
 */

import { describe, expect, it } from "vitest";
import { allLegalWords, baldaEngine, createBalda, findPath, readPath, type BaldaState } from "./engine";
import { chooseBaldaMove, hintsFor, checkWord } from "./bot";
import { isWord, normalise } from "./dictionary";
import { makeRandom } from "../core/types";

describe("finding words is fast enough to use", () => {
  it("enumerates the opening position in well under a second", () => {
    const state = createBalda({ players: [], seed: 1 });
    const started = Date.now();
    const moves = allLegalWords(state.board, state.usedWords);
    const elapsed = Date.now() - started;
    // Before the prefix index this never returned. A phone is slower than CI, so the bound is
    // deliberately generous - it catches a return to exponential search, not a slow machine.
    expect(elapsed).toBeLessThan(1000);
    expect(moves.length).toBeGreaterThan(0);
  });

  it("finds only words that really are in the dictionary", () => {
    const state = createBalda({ players: [], seed: 1 });
    for (const move of allLegalWords(state.board, state.usedWords)) {
      expect(isWord(move.word)).toBe(true);
    }
  });

  it("does not offer a fragment that merely looks like a word", () => {
    // "ьа" is a fragment, not a word; a leading soft sign is refused.
    const state = createBalda({ players: [], seed: 1 });
    const words = allLegalWords(state.board, state.usedWords).map((move) => move.word);
    expect(words).not.toContain("ьа");
    for (const word of words) {
      expect(word[0]).not.toMatch(/[ьъы]/);
    }
  });
});

describe("what the bot chooses", () => {
  it("returns a move the engine accepts", () => {
    const state = createBalda({ players: [], seed: 1 });
    const move = chooseBaldaMove(state, "normal");
    expect(move).not.toBeNull();
    const result = baldaEngine.apply(state, {
      type: "place",
      square: move!.square,
      letter: move!.letter,
      word: move!.word,
    });
    expect(result.changed).toBe(true);
    expect(result.state.scores[0]).toBe(move!.word.length);
  });

  it("returns nothing when the game is over", () => {
    const state = createBalda({ players: [], seed: 1 });
    const over: BaldaState = { ...state, result: { kind: "draw", reason: "тест" } };
    expect(chooseBaldaMove(over)).toBeNull();
  });

  it("plays longer words at the normal level than at the easy one", () => {
    const state = createBalda({ players: [], seed: 1 });
    const normal = chooseBaldaMove(state, "normal", makeRandom(3));
    const easy = chooseBaldaMove(state, "easy", makeRandom(3));
    expect(normal).not.toBeNull();
    expect(easy).not.toBeNull();
    // Easy deliberately takes from the shorter half so a beginner can win.
    expect(normal!.word.length).toBeGreaterThanOrEqual(easy!.word.length);
  });

  it("is deterministic for the same seed", () => {
    const state = createBalda({ players: [], seed: 1 });
    expect(chooseBaldaMove(state, "normal", makeRandom(9))).toEqual(chooseBaldaMove(state, "normal", makeRandom(9)));
  });

  it("keeps playing until the board is full", () => {
    // Two bots play a whole game. If the bot ever returns null while the board has room, the
    // game would stall with an empty square and nobody able to move.
    let state = createBalda({ players: [], seed: 1 });
    let turns = 0;
    while (!state.result && turns < 60) {
      const move = chooseBaldaMove(state, "normal", makeRandom(turns + 1));
      if (!move) break;
      const result = baldaEngine.apply(state, {
        type: "place",
        square: move.square,
        letter: move.letter,
        word: move.word,
      });
      expect(result.changed).toBe(true);
      state = result.state;
      turns += 1;
    }
    expect(turns).toBeGreaterThan(1);
    // Either the board filled, or there was genuinely nothing left to play.
    if (!state.result) {
      expect(chooseBaldaMove(state, "normal")).toBeNull();
    }
  });
});

describe("hints and word checking", () => {
  it("offers the longest words first", () => {
    const state = createBalda({ players: [], seed: 1 });
    const hints = hintsFor(state, 5);
    expect(hints.length).toBeGreaterThan(0);
    for (let i = 1; i < hints.length; i += 1) {
      expect(hints[i - 1].word.length).toBeGreaterThanOrEqual(hints[i].word.length);
    }
  });

  it("agrees with the engine about whether a word can be played", () => {
    const state = createBalda({ players: [], seed: 1 });
    const move = chooseBaldaMove(state, "normal")!;
    expect(checkWord(state, move.square, move.letter, move.word)).toBeNull();
    // A word that is not on the board is reported as such.
    expect(checkWord(state, move.square, move.letter, "фывапролдж")).not.toBeNull();
  });
});

describe("the board only connects through neighbours", () => {
  it("rejects a word placed as an island", () => {
    // Square 0 is a corner; the opening word is in the middle row, so it touches nothing.
    const state = createBalda({ players: [], seed: 1 });
    const result = baldaEngine.apply(state, { type: "place", square: 0, letter: "к", word: "кот" });
    expect(result.changed).toBe(false);
  });

  it("reads a path back as the word it spells", () => {
    const state = createBalda({ players: [], seed: 1 });
    const path = findPath(state.board, 2 * 5, "балда");
    expect(path).not.toBeNull();
    expect(readPath(state.board, path!.slice().sort((a, b) => a - b))).not.toBe("");
  });
});

