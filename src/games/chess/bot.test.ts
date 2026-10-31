/**
 * The bot.
 *
 * Two questions matter more than strength, and they are the ones this suite asks: does it always
 * play a legal move, and does it stop when told to? A bot that occasionally makes an illegal move
 * ends the game for a player in a way no message can explain; one that cannot be cancelled makes a
 * phone wait after the screen has closed.
 *
 * The strength tests are deliberately narrow. It has to find a mate in one and take a hanging
 * queen, because those are the two moves whose absence makes a bot feel broken. It is not asked to
 * play like a master, and no test here pretends the engine has a rating.
 */

import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { chooseMove, DIFFICULTY_LABEL, evaluate, isAnswerLegal, SEARCH_LIMITS } from "./bot";
import { applyChessCommand, createChessSession, START_FEN } from "./session";

/** A view of the position after `moves`. */
function after(moves: string[]): string {
  const chess = new Chess();
  for (const move of moves) chess.move(move);
  return chess.fen();
}

describe("the bot always offers a legal move", () => {
  const positions: [string, string][] = [
    ["the starting position", START_FEN],
    ["after 1.e4 e5", after(["e4", "e5"])],
    ["after the Ruy Lopez", after(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5"])],
    // Both castling and a possible en passant are in reach here.
    ["castling rights on both sides", "r3k2r/ppp1pppp/8/8/1b6/8/PPPPPPPP/R3K2R w KQkq - 0 1"],
    ["in check", "4r1k1/8/8/8/8/8/8/R3K1N1 w - - 0 1"],
    ["one legal move", "7k/8/8/8/8/8/6q1/K7 w - - 0 1"],
  ];

  it.each(positions)("in %s", (_label, fen) => {
    const answer = chooseMove({ fen, difficulty: "normal" });
    expect(answer.move).not.toBeNull();
    expect(isAnswerLegal(fen, answer)).toBe(true);
    // The game engine, not the bot, has the final word: the move it offers must also be one the
    // rules accept.
    const session = createChessSession({ mode: "local", startFen: fen });
    const outcome = applyChessCommand(session, {
      type: "move",
      from: answer.move!.from,
      to: answer.move!.to,
      promotion: answer.move!.promotion,
    });
    expect(outcome.changed).toBe(true);
  });

  // Twenty plies of real search is slower than vitest's default allowance when the whole suite is
  // running in parallel, so the budget is stated rather than inherited.
  it("plays a long game against itself without an illegal move", { timeout: 30_000 }, () => {
    const chess = new Chess();
    let plies = 0;
    while (!chess.isGameOver() && plies < 40) {
      const answer = chooseMove({
        fen: chess.fen(),
        difficulty: "easy",
        random: () => 0.5,
        now: () => 0,
        limits: { depth: 2, budgetMs: 60_000, quiescence: 0 },
      });
      expect(answer.move).not.toBeNull();
      expect(() =>
        chess.move({ from: answer.move!.from, to: answer.move!.to, promotion: answer.move!.promotion })
      ).not.toThrow();
      plies += 1;
    }
    // Twenty plies is a real game in miniature: enough for captures, checks and a promotion to
    // have been possible, not so many that the test becomes a benchmark.
    expect(plies).toBeGreaterThan(20);
  });

  it("says there is no move when the game is already over", () => {
    // Fool's mate: black has won and white has nothing to play.
    const fen = after(["f3", "e5", "g4", "Qh4"]);
    const answer = chooseMove({ fen, difficulty: "normal" });
    expect(answer.move).toBeNull();
    expect(answer.reason).toContain("матом");
  });

  it("promotes to a real piece rather than making an illegal move", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    const answer = chooseMove({ fen, difficulty: "normal" });
    expect(answer.move?.promotion).toBeDefined();
    expect(["q", "r", "b", "n"]).toContain(answer.move?.promotion);
    expect(isAnswerLegal(fen, answer)).toBe(true);
  });
});

describe("the bot takes what is on the board", () => {
  it("finds a mate in one", () => {
    const fen = "7k/6pp/8/8/8/8/8/Q6K w - - 0 1";
    const answer = chooseMove({ fen, difficulty: "normal" });
    expect(answer.move).not.toBeNull();
    const chess = new Chess(fen);
    chess.move({ from: answer.move!.from, to: answer.move!.to, promotion: answer.move!.promotion });
    expect(chess.isCheckmate()).toBe(true);
    expect(answer.score).toBeGreaterThan(50000);
  });

  it("takes a hanging queen rather than a harmless move", () => {
    // The black queen on a4 stands on the a-file, unguarded, in front of the white rook on a1.
    const fen = "6k1/7p/8/8/q7/8/8/R5K1 w - - 0 1";
    const answer = chooseMove({ fen, difficulty: "normal" });
    expect({ from: answer.move?.from, to: answer.move?.to }).toEqual({ from: "a1", to: "a4" });
  });

  it("values material in the evaluation", () => {
    expect(evaluate(new Chess(START_FEN))).toBe(0);
    // The same board with the black queen removed is worth a queen to white.
    expect(evaluate(new Chess("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"))).toBeGreaterThan(800);
  });
});

describe("the bot gives up its turn when told to", () => {
  it("stops quickly when the caller cancels", () => {
    // The clock advances on every reading, so a search that ignored cancellation would think for
    // its whole budget. A cancelled search must come back promptly, still with a legal move.
    let reads = 0;
    const started = Date.now();
    const answer = chooseMove({
      fen: START_FEN,
      difficulty: "normal",
      now: () => (reads += 1) * 0.001,
      isCancelled: () => reads > 8,
      limits: { depth: 4, budgetMs: 10_000, quiescence: 4 },
    });
    expect(answer.move).not.toBeNull();
    expect(isAnswerLegal(START_FEN, answer)).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("still returns a legal move when cancelled before it starts", () => {
    const answer = chooseMove({
      fen: START_FEN,
      difficulty: "normal",
      isCancelled: () => true,
      limits: { depth: 4, budgetMs: 10_000, quiescence: 4 },
    });
    // Nothing was searched, but a legal move is still on the table rather than a crash or null.
    expect(answer.move).not.toBeNull();
    expect(isAnswerLegal(START_FEN, answer)).toBe(true);
  });

  it("respects its own time budget", () => {
    let elapsed = 0;
    const started = Date.now();
    chooseMove({
      fen: after(["e4", "e5", "Nf3", "Nc6"]),
      difficulty: "normal",
      now: () => (elapsed += 5),
      limits: { depth: 6, budgetMs: 40, quiescence: 2 },
    });
    // The clock is virtual, so what is asserted is that the deadline is actually consulted: a
    // search that ignored it would finish all six depths with no time to spare.
    expect(elapsed).toBeLessThan(3000);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("never searches deeper than its level allows", () => {
    const answer = chooseMove({ fen: "7k/6pp/8/8/8/8/8/Q6K w - - 0 1", difficulty: "normal" });
    expect(answer.depth).toBeLessThanOrEqual(SEARCH_LIMITS.normal.depth);
  });
});

describe("the difficulty levels", () => {
  it("names each level and describes what it does", () => {
    expect(DIFFICULTY_LABEL.easy).toBe("Начальный");
    expect(DIFFICULTY_LABEL.normal).toBe("Обычный");
    expect(Object.keys(DIFFICULTY_LABEL)).toEqual(["easy", "normal"]);
  });

  it("lets the easy level choose imperfectly, but only among legal moves", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const answer = chooseMove({
        fen: START_FEN,
        difficulty: "easy",
        random: () => i / 8,
        now: () => 0,
        limits: { depth: 2, budgetMs: 60_000, quiescence: 0 },
      });
      expect(answer.move).not.toBeNull();
      expect(isAnswerLegal(START_FEN, answer)).toBe(true);
      picks.add(`${answer.move!.from}${answer.move!.to}`);
    }
    expect(picks.size).toBeGreaterThan(0);
  });
});
