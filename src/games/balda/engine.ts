/**
 * «Балда» - the game where one letter turns into a word.
 *
 * The placeholders replaced here accepted any Russian word typed into a box: no board, no
 * path, no second player. The rules below are the chosen variant, written down because "Балда"
 * has several mutually incompatible house rules and two players who grew up with different
 * ones will disagree about the first move:
 *
 *   - a real 5x5 board, opening word of five letters across the middle row;
 *   - each turn adds exactly one letter into an empty square that touches an existing letter
 *     orthogonally;
 *   - the new letter must be part of the word, and the word is a continuous path through the
 *     new letter, orthogonally, without reusing a square;
 *   - a word scores one point per letter, and neither player may repeat a word;
 *   - the game ends when the board is full or both players pass in a row;
 *   - ё and е are the same letter, everywhere.
 */

import type { ApplyResult, CreateOptions, GameEngine, GameResult, Player } from "../core/types";
import { dictionaryReady, isPrefix, isWord, normalise } from "./dictionary";

export const BOARD_SIZE = 5;
export const START_WORD = "БАЛДА";

/** The board is 25 squares; a letter or null. */
export type Board = (string | null)[];

export type BaldaState = {
  board: Board;
  /** Whose turn it is, by player index. */
  turnIndex: number;
  scores: [number, number];
  /** Every word used by either player, normalised, so nobody may repeat another's word. */
  usedWords: string[];
  /** How many turns in a row each player passed. Two in a row ends the game. */
  passes: [number, number];
  result: GameResult | null;
  /** The move being built, so an interface can show it before it is confirmed. */
  pending: PendingMove | null;
  seed: number;
};

export type PendingMove = {
  letter: string;
  square: number;
  /** The word as typed so far, or null while the path is being chosen. */
  word: string | null;
};

const CENTRE_ROW_START = 2 * BOARD_SIZE;

export function emptyBoard(): Board {
  return Array(BOARD_SIZE * BOARD_SIZE).fill(null);
}

/** Places START_WORD across the middle row. It scores nothing and cannot be taken again. */
export function initialBoard(): Board {
  const board = emptyBoard();
  for (let i = 0; i < START_WORD.length; i += 1) {
    board[CENTRE_ROW_START + i] = START_WORD[i];
  }
  return board;
}

export function rowOf(index: number): number {
  return Math.floor(index / BOARD_SIZE);
}

export function colOf(index: number): number {
  return index % BOARD_SIZE;
}

/** Orthogonal neighbours, never wrapping around the edge. */
export function neighbours(index: number): number[] {
  const out: number[] = [];
  const row = rowOf(index);
  const col = colOf(index);
  if (row > 0) out.push((row - 1) * BOARD_SIZE + col);
  if (row < BOARD_SIZE - 1) out.push((row + 1) * BOARD_SIZE + col);
  if (col > 0) out.push(row * BOARD_SIZE + col - 1);
  if (col < BOARD_SIZE - 1) out.push(row * BOARD_SIZE + col + 1);
  return out;
}

/**
 * Empty squares where a letter may be placed: they must touch at least one existing letter.
 *
 * An isolated empty square is a legal place for a letter in some house rules, but not in this
 * one - a word has to connect to what is already on the board, or the game becomes a
 * collection of unrelated islands.
 */
export function playableSquares(board: Board): number[] {
  const out: number[] = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue;
    if (neighbours(index).some((neighbour) => board[neighbour] !== null)) out.push(index);
  }
  return out;
}

/**
 * Finds the path that spells `word` on the board with the new letter at `placed`.
 *
 * The new letter must be part of it, otherwise a player could confirm a word that has nothing
 * to do with the letter they just put down.
 */
export function findPath(board: Board, placed: number, word: string): number[] | null {
  const target = normalise(word);
  if (!/^[а-я]+$/.test(target)) return null;
  if (placed < 0 || placed >= board.length) return null;

  const letters: string[] = board.map((cell) => (cell === null ? "" : normalise(cell)));
  const path: number[] = [];
  const used = new Set<number>();

  // Walks forward from `index`, collecting a simple path. Succeeds only if the whole word is
  // spelled and the path passes through the square that was just filled.
  function walk(index: number, position: number): boolean {
    path.push(index);
    used.add(index);
    if (position === target.length - 1) {
      if (path.includes(placed)) return true;
    } else {
      for (const next of neighbours(index)) {
        if (used.has(next)) continue;
        if (letters[next] !== target[position + 1]) continue;
        if (walk(next, position + 1)) return true;
      }
    }
    path.pop();
    used.delete(index);
    return false;
  }

  // Try every square carrying the first letter; the placed square will be checked for
  // inclusion as the path is built, so a word that avoids the new letter cannot pass.
  for (let start = 0; start < letters.length; start += 1) {
    if (letters[start] !== target[0]) continue;
    path.length = 0;
    used.clear();
    if (walk(start, 0)) return path.slice();
  }
  return null;
}

/**
 * Every word a player could form by placing `letter` on `square`.
 *
 * The search walks paths, but stops as soon as the letters so far cannot begin any word in the
 * dictionary. Without that cutoff the number of simple paths on a 5x5 board is large enough to
 * freeze a browser tab for minutes - which is exactly what a naive implementation did before
 * this was measured.
 */
export function wordsWithLetter(board: Board, square: number, letter: string): string[] {
  const withLetter = board.slice();
  withLetter[square] = letter.toLocaleUpperCase("ru-RU");
  const letters: string[] = withLetter.map((cell) => (cell === null ? "" : normalise(cell)));
  const words = new Set<string>();

  const walk = (index: number, text: string, seen: Set<number>, passedNew: boolean) => {
    const throughNew = passedNew || index === square;
    if (text.length >= 2 && throughNew && isWord(text)) words.add(text);
    for (const next of neighbours(index)) {
      if (seen.has(next)) continue;
      const nextLetter = letters[next];
      if (nextLetter === "") continue;
      const candidate = text + nextLetter;
      // Dead end: no word in the dictionary starts with these letters.
      if (!isPrefix(candidate)) continue;
      seen.add(next);
      walk(next, candidate, seen, throughNew || next === square);
      seen.delete(next);
    }
  };

  for (let start = 0; start < letters.length; start += 1) {
    if (letters[start] === "") continue;
    walk(start, letters[start], new Set([start]), start === square);
  }
  return [...words];
}

export type BaldaAction =
  | { type: "place"; square: number; letter: string; word: string }
  | { type: "pass" }
  | { type: "resign" };

export function createBalda(options: CreateOptions): BaldaState {
  return {
    board: initialBoard(),
    turnIndex: 0,
    scores: [0, 0],
    // The opening word is not a scoring move and cannot be used again.
    usedWords: [normalise(START_WORD)],
    passes: [0, 0],
    result: null,
    pending: null,
    seed: options.seed,
  };
}

/** Whether the board has no empty square left. */
export function isFull(board: Board): boolean {
  return board.every((cell) => cell !== null);
}

function finish(state: BaldaState, result: GameResult): BaldaState {
  return { ...state, result };
}

/** Decides the game when it cannot continue: fuller board, or two passes. */
function settle(state: BaldaState): BaldaState {
  if (isFull(state.board)) {
    const [a, b] = state.scores;
    if (a === b) return finish(state, { kind: "draw", reason: "поле заполнено, счёт равный" });
    return finish(state, { kind: "win", winnerId: winnerId(state), reason: "поле заполнено" });
  }
  // "Two passes in a row" means both players passed: one each. Requiring two from the same
  // player meant two passes never ended anything, and a game where nobody can move went on
  // forever. The counters reset on a real move, so this is the same condition.
  if (state.passes[0] >= 1 && state.passes[1] >= 1) {
    const [a, b] = state.scores;
    if (a === b) return finish(state, { kind: "draw", reason: "два пропуска подряд, счёт равный" });
    return finish(state, { kind: "win", winnerId: winnerId(state), reason: "два пропуска подряд" });
  }
  return state;
}

function winnerId(state: BaldaState): string {
  void state;
  return state.scores[0] >= state.scores[1] ? "player-1" : "player-2";
}

export const BALDA_RULES = [
  "Поле 5×5, по центру — слово БАЛДА. Оно не приносит очков и повторить его нельзя.",
  "За ход вы добавляете одну букву в пустую клетку, соседнюю по стороне с уже стоящими буквами.",
  "Слово читается непрерывно по горизонтали и вертикали, без диагоналей и без повторения клеток.",
  "Слово обязательно проходит через только что поставленную букву.",
  "Очков даёт по числу букв. Повторять слова, уже сыгранные любым игроком, нельзя.",
  "Ё и Е считаются одной буквой.",
  "Игра заканчивается, когда поле заполнено или оба игрока пропустили ход подряд.",
];

export const baldaEngine: GameEngine<BaldaState, BaldaAction> = {
  kind: "balda",
  rulesVersion: 1,
  rules: BALDA_RULES,
  create: createBalda,

  actions(state) {
    if (state.result) return [];
    const out: BaldaAction[] = [{ type: "pass" }, { type: "resign" }];
    return out;
  },

  apply(state, action): ApplyResult<BaldaState> {
    if (state.result) {
      return { state, changed: false, reason: "Игра закончена" };
    }
    const playerIndex = state.turnIndex;

    if (action.type === "resign") {
      const loser = playerIndex;
      return {
        state: finish(state, { kind: "win", winnerId: loser === 0 ? "player-2" : "player-1", reason: "сдача" }),
        changed: true,
      };
    }

    if (action.type === "pass") {
      const passes: [number, number] = [state.passes[0], state.passes[1]];
      passes[playerIndex] += 1;
      const next = settle({ ...state, passes, turnIndex: playerIndex === 0 ? 1 : 0, pending: null });
      return { state: next, changed: true };
    }

    if (!dictionaryReady()) {
      // The plan is explicit: never fall back to accepting anything.
      return { state, changed: false, reason: "Словарь не загрузился. Повторите загрузку" };
    }

    const letter = normalise(action.letter);
    if (!/^[а-я]$/.test(letter)) {
      return { state, changed: false, reason: "Нужна одна русская буква" };
    }
    if (state.board[action.square] !== null) {
      return { state, changed: false, reason: "Эта клетка уже занята" };
    }
    if (!playableSquares(state.board).includes(action.square)) {
      return { state, changed: false, reason: "Букву можно поставить только рядом с уже стоящими буквами" };
    }

    const board = state.board.slice();
    board[action.square] = letter.toLocaleUpperCase("ru-RU");
    const word = normalise(action.word);

    if (word.length < 2) {
      return { state, changed: false, reason: "Слово должно состоять хотя бы из двух букв" };
    }
    if (!isWord(word)) {
      return { state, changed: false, reason: `«${action.word}» нет в словаре игры` };
    }
    if (state.usedWords.includes(word)) {
      return { state, changed: false, reason: "Это слово уже было" };
    }
    const path = findPath(board, action.square, word);
    if (!path) {
      return { state, changed: false, reason: "Такого слова на поле не получается" };
    }

    const scores: [number, number] = [state.scores[0], state.scores[1]];
    scores[playerIndex] += word.length;
    const passes: [number, number] = [0, 0];
    const next: BaldaState = {
      ...state,
      board,
      scores,
      usedWords: [...state.usedWords, word],
      passes,
      pending: null,
      turnIndex: playerIndex === 0 ? 1 : 0,
    };
    return { state: settle(next), changed: true };
  },

  result(state) {
    return state.result;
  },

  describe(state) {
    if (state.result) return "Игра закончена";
    return state.turnIndex === 0 ? "Ход первого игрока" : "Ход второго игрока";
  },
};

/** The word a path spells, for showing it to the player before confirming. */
export function readPath(board: Board, path: number[]): string {
  return path.map((index) => board[index] ?? "").join("");
}

/**
 * Every legal word for the player who may move, used by the bot and by a hint button.
 *
 * Computed from the actual board each time, so a bot cannot produce a word that is not there.
 */
export function allLegalWords(board: Board, usedWords: string[]): { word: string; square: number; letter: string }[] {
  const out: { word: string; square: number; letter: string }[] = [];
  const seen = new Set<string>();
  // A word can only use a letter that appears in `a` dictionary word in the middle, so the
  // alphabet is narrowed to letters that actually occur - not because it saves typing, but
  // because the search multiplies by the number of letters tried.
  const triedLetters = "абвгдежзийклмнопрстуфхцчшщъыьэюя";
  for (const square of playableSquares(board)) {
    for (const letter of triedLetters) {
      for (const word of wordsWithLetter(board, square, letter)) {
        if (word.length < 2) continue;
        if (usedWords.includes(word)) continue;
        const key = `${square}:${word}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ word, square, letter });
      }
    }
  }
  return out;
}

export function playersByName(players: Player[]): [Player, Player] {
  return [players[0], players[1]];
}
