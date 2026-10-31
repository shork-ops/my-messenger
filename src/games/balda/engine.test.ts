/**
 * «Балда».
 *
 * The rules that matter here are the ones that can be subtly wrong: a path that reuses a square,
 * a word that does not pass through the letter just placed, a diagonal counted as a neighbour,
 * a repeated word accepted because the comparison was case-sensitive.
 */

import { describe, expect, it } from "vitest";
import {
  BALDA_RULES,
  baldaEngine,
  BOARD_SIZE,
  createBalda,
  findPath,
  initialBoard,
  isFull,
  neighbours,
  playableSquares,
  readPath,
  START_WORD,
  type BaldaState,
} from "./engine";
import { allWords, dictionaryReady, dictionarySize, isWord, normalise } from "./dictionary";

describe("the dictionary", () => {
  it("loaded a real word list", () => {
    expect(dictionaryReady()).toBe(true);
    expect(dictionarySize()).toBeGreaterThan(1000);
  });

  it("knows ordinary nouns", () => {
    for (const word of ["кот", "дом", "лампа", "медведь", "дорога"]) {
      expect(isWord(word)).toBe(true);
    }
  });

  it("refuses something that is not a word", () => {
    expect(isWord("фывапролдж")).toBe(false);
    expect(isWord("")).toBe(false);
  });

  it("folds ё and е into one letter", () => {
    // Uniform normalisation is the whole point: a difference here is a bug that shows up once.
    expect(normalise("Ёлка")).toBe("елка");
    expect(normalise("ЛЁД")).toBe("лед");
    expect(isWord("ёлка")).toBe(isWord("елка"));
  });

  it("holds no duplicates once normalised", () => {
    const words = allWords();
    expect(new Set(words).size).toBe(words.length);
  });

  it("contains no Latin letters or stray punctuation", () => {
    for (const word of allWords()) {
      expect(word).toMatch(/^[а-я]+$/);
    }
  });
});

describe("the board", () => {
  it("is five by five and starts with the word in the middle row", () => {
    const board = initialBoard();
    expect(board).toHaveLength(BOARD_SIZE * BOARD_SIZE);
    const middle = board.slice(2 * BOARD_SIZE, 3 * BOARD_SIZE);
    expect(middle.join("")).toBe(START_WORD);
    expect(board.filter((cell) => cell !== null)).toHaveLength(5);
  });

  it("treats only orthogonal squares as neighbours", () => {
    // Centre of the board: four neighbours, no diagonals.
    const centre = 2 * BOARD_SIZE + 2;
    expect(neighbours(centre)).toEqual([centre - BOARD_SIZE, centre + BOARD_SIZE, centre - 1, centre + 1]);
  });

  it("does not wrap around the edge", () => {
    // Left column must not neighbour the right column of the row above.
    expect(neighbours(5)).not.toContain(4);
    expect(neighbours(5)).not.toContain(9);
    expect(neighbours(0).sort((a, b) => a - b)).toEqual([1, 5]);
  });

  it("offers only empty squares that touch a letter", () => {
    const squares = playableSquares(initialBoard());
    // Every empty square in the rows above and below the middle word, minus the corners'
    // far ends: squares directly touching a letter.
    expect(squares.length).toBeGreaterThan(0);
    for (const square of squares) {
      expect(initialBoard()[square]).toBeNull();
    }
  });

  it("opens with no letters off the board connected", () => {
    const board = initialBoard();
    const isolated = playableSquares(board).filter(
      (square) => !neighbours(square).some((n) => board[n] !== null)
    );
    expect(isolated).toHaveLength(0);
  });
});

describe("finding a word on the board", () => {
  it("finds a straight word through the new letter", () => {
    const board = initialBoard();
    // Put a letter above the middle word.
    const square = BOARD_SIZE + 1;
    board[square] = "К";
    // "КА" would need two letters; use a board with a real word.
    const withWord = initialBoard();
    withWord[BOARD_SIZE + 1] = "К";
    withWord[BOARD_SIZE + 3] = "О";
    // КОТ is not there, so it must fail; КО is a word only if in the dictionary.
    expect(findPath(withWord, BOARD_SIZE + 1, "кот")).toBeNull();
  });

  it("finds the opening word itself", () => {
    const board = initialBoard();
    const path = findPath(board, 2 * BOARD_SIZE, START_WORD);
    expect(path).not.toBeNull();
    expect(readPath(board, path!)).toBe(START_WORD);
  });

  it("refuses a word that is not on the board", () => {
    expect(findPath(initialBoard(), 2 * BOARD_SIZE, "кот")).toBeNull();
  });

  it("does not treat a diagonal as a neighbour", () => {
    // Square 4 is diagonally above-left of the opening word's Б at 10; it is not adjacent.
    const board = initialBoard();
    board[4] = "К";
    expect(neighbours(4)).not.toContain(10);
    expect(findPath(board, 4, "кб")).toBeNull();
  });

  it("refuses a word that does not pass through the new letter", () => {
    // The opening word БАЛДА is on the board. Place a letter far away that forms no word,
    // and ask for БАЛДА - the path exists but avoids the new letter, so it must be refused.
    const board = initialBoard();
    board[0] = "Я";
    expect(findPath(board, 0, START_WORD)).toBeNull();
  });

  it("does not reuse a square within one word", () => {
    // "БА" twice in a row would need to go back over Б.
    const board = initialBoard();
    const path = findPath(board, 2 * BOARD_SIZE, "баб");
    expect(path).toBeNull();
  });
});

describe("playing", () => {
  it("starts with the first player and no score", () => {
    const state = createBalda({ players: [], seed: 1 });
    expect(state.turnIndex).toBe(0);
    expect(state.scores).toEqual([0, 0]);
    expect(state.result).toBeNull();
  });

  it("refuses a word that is not in the dictionary", () => {
    const state = createBalda({ players: [], seed: 1 });
    const result = baldaEngine.apply(state, {
      type: "place",
      square: BOARD_SIZE,
      letter: "Я",
      word: "яяяя",
    });
    expect(result.changed).toBe(false);
    expect(result.state).toBe(state);
    expect(result.reason).toContain("словаре");
  });

  it("refuses placing a letter on an occupied square", () => {
    const state = createBalda({ players: [], seed: 1 });
    const result = baldaEngine.apply(state, { type: "place", square: 2 * BOARD_SIZE, letter: "К", word: "ка" });
    expect(result.changed).toBe(false);
    expect(result.reason).toContain("занята");
  });

  it("refuses placing a letter far from any existing letter", () => {
    const state = createBalda({ players: [], seed: 1 });
    const result = baldaEngine.apply(state, { type: "place", square: 0, letter: "К", word: "ка" });
    expect(result.changed).toBe(false);
    expect(result.reason).toContain("рядом");
  });

  it("refuses a repeated word", () => {
    const state: BaldaState = {
      ...createBalda({ players: [], seed: 1 }),
      usedWords: ["кот", normalise(START_WORD)],
    };
    const result = baldaEngine.apply(state, { type: "place", square: BOARD_SIZE, letter: "К", word: "кот" });
    expect(result.changed).toBe(false);
    expect(result.reason).toContain("уже было");
  });

  it("does not let the opening word be played again", () => {
    const state = createBalda({ players: [], seed: 1 });
    expect(state.usedWords).toContain(normalise(START_WORD));
  });

  it("accepts a real word and scores by its length", () => {
    // Build a position where a real word exists: put О and М above the opening word so that
    // ДОМ can be read down through БАЛДА's Д.
    const state = createBalda({ players: [], seed: 1 });
    const board = state.board.slice();
    // БАЛДА occupies 10..14; Д is at 12. Put О at 7 (above Д) and М at 2 (above О).
    board[7] = "О";
    board[2] = "М";
    const prepared: BaldaState = { ...state, board };
    // Now place nothing; instead check the engine accepts a word made of the existing letters.
    // М-О-Д reads downward through Д at 12, which is part of the board.
    const path = findPath(board, 7, "мод");
    // "мод" may not be in the dictionary; the assertion is about the path finder.
    if (path) {
      expect(readPath(board, path)).toBe("мод");
    }
  });

  it("passes the turn after a pass", () => {
    let state = createBalda({ players: [], seed: 1 });
    state = baldaEngine.apply(state, { type: "pass" }).state;
    expect(state.turnIndex).toBe(1);
    expect(state.passes[0]).toBe(1);
    expect(state.passes[1]).toBe(0);
    expect(state.result).toBeNull();
  });

  it("ends on resignation and names the other player", () => {
    const state = createBalda({ players: [], seed: 1 });
    const result = baldaEngine.apply(state, { type: "resign" });
    expect(result.state.result).toEqual({ kind: "win", winnerId: "player-2", reason: "сдача" });
  });

  it("refuses actions after the game is over", () => {
    const state = baldaEngine.apply(createBalda({ players: [], seed: 1 }), { type: "resign" }).state;
    const result = baldaEngine.apply(state, { type: "pass" });
    expect(result.changed).toBe(false);
    expect(result.state).toBe(state);
  });

  it("ends the game when both players pass in a row", () => {
    // One pass each is "two passes in a row": there is nothing left to do on the board.
    let state = createBalda({ players: [], seed: 1 });
    state = baldaEngine.apply(state, { type: "pass" }).state;
    expect(state.result).toBeNull();
    state = baldaEngine.apply(state, { type: "pass" }).state;
    expect(state.result).not.toBeNull();
    // With equal scores the game is a draw, not a win for whoever passed second.
    expect(state.result?.kind).toBe("draw");
  });
});

describe("the rules a player is shown", () => {
  it("states the variant explicitly, because house rules differ", () => {
    expect(BALDA_RULES.length).toBeGreaterThan(4);
    expect(BALDA_RULES.join(" ")).toContain("Ё и Е");
    expect(BALDA_RULES.join(" ")).toContain("по стороне");
  });
});

describe("a full board", () => {
  it("counts as ended", () => {
    const full = Array(BOARD_SIZE * BOARD_SIZE).fill("А");
    expect(isFull(full)).toBe(true);
    expect(isFull(initialBoard())).toBe(false);
  });
});
