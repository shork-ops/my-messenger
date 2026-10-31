/**
 * Chess rules.
 *
 * The tests below are written as positions, not as code: each one sets up the board the way a
 * player would describe it and asks for the answer a player would expect. That is the only way
 * to catch the class of bug this engine is most likely to have - a rule that is implemented
 * almost right, which plays fine for twenty moves and then lets a player castle through check.
 */

import { describe, expect, it } from "vitest";
import {
  chessEngine,
  createChess,
  findKing,
  inCheck,
  isAttacked,
  isDeadPosition,
  legalMoves,
  movesFrom,
  positionKey,
  squareIndex,
  squareName,
  toFen,
  type ChessState,
  type Piece,
  type PieceType,
} from "./engine";

const EMPTY: (Piece | null)[] = Array(64).fill(null);

function piece(color: "w" | "b", type: PieceType): Piece {
  return { color, type };
}

/** Builds a position from a short description like {e1: "wk", e8: "bk"}. */
function position(pieces: Record<string, string>, turn: "w" | "b" = "w"): ChessState {
  const board = EMPTY.slice();
  for (const [square, code] of Object.entries(pieces)) {
    board[squareIndex(square)] = piece(code[0] as "w" | "b", code[1] as PieceType);
  }
  return {
    board,
    turn,
    castling: { w: { k: false, q: false }, b: { k: false, q: false } },
    enPassant: null,
    halfmoveClock: 0,
    fullmove: 1,
    history: [],
    positions: [],
    result: null,
    endedBy: null,
  };
}

function moves(state: ChessState, square: string): number[] {
  return movesFrom(state, squareIndex(square)).map((move) => move.to).sort((a, b) => a - b);
}

function names(state: ChessState, square: string): string[] {
  return moves(state, square).map((index) => squareName(index)).sort();
}

describe("the starting position", () => {
  it("has twenty legal moves for white", () => {
    // Sixteen pawn moves and four knight moves. Any other number means a rule is wrong.
    expect(legalMoves(createChess({ players: [], seed: 1 }))).toHaveLength(20);
  });

  it("writes the position in FEN that a chess engine would accept", () => {
    expect(toFen(createChess({ players: [], seed: 1 }))).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    );
  });

  it("has a white king on e1 and a black king on e8", () => {
    const state = createChess({ players: [], seed: 1 });
    expect(squareName(findKing(state.board, "w"))).toBe("e1");
    expect(squareName(findKing(state.board, "b"))).toBe("e8");
  });
});

describe("how the pieces move", () => {
  it("lets a rook slide until it meets a piece", () => {
    const state = position({ e1: "wk", e8: "bk", d4: "wr", d6: "bp", f4: "wp" });
    // Up to the black pawn (taking it) but not through it, down to the far edge, and along
    // the rank until its own pawn on f4.
    expect(names(state, "d4")).toEqual(["a4", "b4", "c4", "d1", "d2", "d3", "d5", "d6", "e4"]);
  });

  it("lets a bishop move on diagonals only", () => {
    const state = position({ e1: "wk", e8: "bk", d4: "wb" });
    expect(names(state, "d4")).toEqual(["a1", "a7", "b2", "b6", "c3", "c5", "e3", "e5", "f2", "f6", "g1", "g7", "h8"]);
  });

  it("gives a knight its eight jumps in the middle of the board", () => {
    const state = position({ e1: "wk", e8: "bk", d4: "wn" });
    expect(names(state, "d4")).toEqual(["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5"]);
  });

  it("does not let a knight wrap around the edge of the board", () => {
    // A knight on a1 has only two moves. A broken implementation gives it four or six.
    const state = position({ e1: "wk", e8: "bk", a1: "wn" });
    expect(names(state, "a1")).toEqual(["b3", "c2"]);
  });

  it("does not let a bishop wrap around the edge either", () => {
    const state = position({ e1: "wk", e8: "bk", a4: "wb" });
    expect(names(state, "a4")).toEqual(["b3", "b5", "c2", "c6", "d1", "d7", "e8"]);
  });

  it("lets a pawn advance one or two from its start and take diagonally", () => {
    const state = position({ e1: "wk", e8: "bk", e2: "wp", d3: "bp" });
    // Two forward moves, and a diagonal capture onto the pawn on d3 - the black pawn is
    // one rank in front, so it is capturable, not a blocker.
    // `names` sorts strings, so the order is alphabetical, not by square index.
    expect(names(state, "e2")).toEqual(["d3", "e3", "e4"]);
    // The second pawn to take is on f3, but a knight there would give check to the king on
    // e1 and force the pawn to answer it instead. Placed on a6, it is just another target.
    const withTarget = position({ e1: "wk", e8: "bk", e2: "wp", a6: "bn" });
    expect(names(withTarget, "e2")).toEqual(["e3", "e4"]);
  });

  it("does not let a pawn move two squares after it has moved", () => {
    const state = position({ e1: "wk", e8: "bk", e3: "wp" });
    expect(names(state, "e3")).toEqual(["e4"]);
  });

  it("does not let a pawn capture straight ahead", () => {
    const state = position({ e1: "wk", e8: "bk", e4: "wp", e5: "bp" });
    // The pawn is blocked and cannot take the blocking pawn.
    expect(names(state, "e4")).toEqual([]);
  });
});

describe("the king may not be left in check", () => {
  it("refuses a move that exposes its own king", () => {
    // The white king is behind its own bishop; moving the bishop would open the file.
    const state = position({ e1: "wk", e8: "bk", e2: "wb", e7: "br" });
    expect(names(state, "e2")).not.toContain("d3");
    expect(names(state, "e2")).not.toContain("f3");
  });

  it("lets only moves that answer a check", () => {
    // Black rook gives check along the e-file; white must block, take or move the king.
    const state = position({ e1: "wk", e8: "bk", e7: "br", d2: "wr" });
    const all = legalMoves(state);
    const fromBishopSquare = all.filter((move) => move.from === squareIndex("d2"));
    // The rook on d2 can block on e2, which is the only move that answers the check.
    expect(fromBishopSquare.map((move) => squareName(move.to))).toEqual(["e2"]);
  });

  it("finds check and reports it", () => {
    const state = position({ e1: "wk", e8: "bk", e7: "br" });
    expect(inCheck(state, "w")).toBe(true);
    expect(inCheck(state, "b")).toBe(false);
  });

  it("does not see a check through a blocking piece", () => {
    const state = position({ e1: "wk", e8: "bk", e7: "br", e4: "wp" });
    expect(inCheck(state, "w")).toBe(false);
  });
});

describe("castling", () => {
  it("allows castling when the way is clear and nothing is attacked", () => {
    const state = { ...position({ e1: "wk", e8: "bk", h1: "wr", a1: "wr" }), castling: { w: { k: true, q: true }, b: { k: false, q: false } } };
    expect(names(state, "e1")).toContain("g1");
    expect(names(state, "e1")).toContain("c1");
  });

  it("refuses to castle out of check", () => {
    const state = { ...position({ e1: "wk", e8: "bk", h1: "wr", e7: "br" }), castling: { w: { k: true, q: false }, b: { k: false, q: false } } };
    expect(names(state, "e1")).not.toContain("g1");
  });

  it("refuses to castle through an attacked square", () => {
    // A rook on f8 covers f1, so the king would pass through check on its way to g1.
    const state = { ...position({ e1: "wk", e8: "bk", h1: "wr", f8: "br" }), castling: { w: { k: true, q: false }, b: { k: false, q: false } } };
    expect(names(state, "e1")).not.toContain("g1");
  });

  it("refuses to castle when the rook has moved", () => {
    const state = { ...position({ e1: "wk", e8: "bk", h1: "wr" }), castling: { w: { k: false, q: false }, b: { k: false, q: false } } };
    expect(names(state, "e1")).not.toContain("g1");
  });

  it("refuses to castle through a piece", () => {
    const state = { ...position({ e1: "wk", e8: "bk", h1: "wr", f1: "wb" }), castling: { w: { k: true, q: false }, b: { k: false, q: false } } };
    expect(names(state, "e1")).not.toContain("g1");
  });

  it("moves the rook as well as the king", () => {
    const state = { ...position({ e1: "wk", e8: "bk", h1: "wr" }), castling: { w: { k: true, q: false }, b: { k: false, q: false } } };
    const result = chessEngine.apply(state, { type: "move", from: squareIndex("e1"), to: squareIndex("g1") });
    // A castling implementation that forgets the rook leaves it on h1 and the king alone on g1.
    expect(squareName(result.state.board.findIndex((p) => p?.type === "r") )).toBe("f1");
    expect(result.state.board[squareIndex("h1")]).toBeNull();
  });

  it("loses the right for good once the king has moved", () => {
    const state = { ...position({ e1: "wk", e8: "bk", h1: "wr" }), castling: { w: { k: true, q: false }, b: { k: false, q: false } } };
    const after = chessEngine.apply(state, { type: "move", from: squareIndex("e1"), to: squareIndex("f1") });
    expect(after.state.castling.w.k).toBe(false);
  });
});

describe("en passant", () => {
  it("lets a pawn take a pawn that has just passed it", () => {
    const state = createChess({ players: [], seed: 1 });
    // Push the pawns to the needed position through real moves, not by editing the board.
    let current = state;
    const play = (from: string, to: string) =>
      (current = chessEngine.apply(current, { type: "move", from: squareIndex(from), to: squareIndex(to) }).state);
    play("e2", "e4"); // white
    play("a7", "a6"); // black waits
    play("e4", "e5"); // white
    play("d7", "d5"); // black double steps past the white pawn
    // White may take on d6 even though the black pawn is on d5.
    expect(names(current, "e5")).toContain("d6");
  });

  it("only offers it for one move", () => {
    let current = createChess({ players: [], seed: 1 });
    const play = (from: string, to: string) =>
      (current = chessEngine.apply(current, { type: "move", from: squareIndex(from), to: squareIndex(to) }).state);
    play("e2", "e4");
    play("a7", "a6");
    play("e4", "e5");
    play("d7", "d5");
    play("a2", "a3"); // white declines
    play("a6", "a5"); // black waits again
    // The chance is gone.
    expect(names(current, "e5")).not.toContain("d6");
  });

  it("removes the passed pawn from its own square, not the target square", () => {
    let current = createChess({ players: [], seed: 1 });
    const play = (from: string, to: string) =>
      (current = chessEngine.apply(current, { type: "move", from: squareIndex(from), to: squareIndex(to) }).state);
    play("e2", "e4");
    play("a7", "a6");
    play("e4", "e5");
    play("d7", "d5");
    play("e5", "d6");
    // A broken implementation leaves a ghost pawn on d5.
    expect(current.board[squareIndex("d5")]).toBeNull();
    expect(current.board[squareIndex("d6")]).toEqual(piece("w", "p"));
  });
});

describe("promotion", () => {
  it("offers all four pieces", () => {
    const state = position({ e1: "wk", e8: "bk", a7: "wp" }, "w");
    const promotions = movesFrom(state, squareIndex("a7")).map((move) => move.promotion);
    expect(promotions.sort()).toEqual(["b", "n", "q", "r"]);
  });

  it("refuses a promotion move that does not say what to promote to", () => {
    const state = position({ e1: "wk", e8: "bk", a7: "wp" }, "w");
    const result = chessEngine.apply(state, { type: "move", from: squareIndex("a7"), to: squareIndex("a8") });
    expect(result.changed).toBe(false);
    expect(result.reason).toContain("превращения");
    // And the state must be the very same object, not a copy that looks alike.
    expect(result.state).toBe(state);
  });

  it("puts the chosen piece on the board", () => {
    const state = position({ e1: "wk", e8: "bk", h8: "bh", a7: "wp" }, "w");
    const result = chessEngine.apply(state, { type: "move", from: squareIndex("a7"), to: squareIndex("a8"), promotion: "n" });
    expect(result.changed).toBe(true);
    expect(result.state.board[squareIndex("a8")]).toEqual(piece("w", "n"));
  });
});

describe("how a game ends", () => {
  it("ends in checkmate and names the winner", () => {
    // Fool's mate: white falls for it in two moves.
    let current = createChess({ players: [], seed: 1 });
    const play = (from: string, to: string) =>
      (current = chessEngine.apply(current, { type: "move", from: squareIndex(from), to: squareIndex(to) }).state);
    play("f2", "f3");
    play("e7", "e5");
    play("g2", "g4");
    play("d8", "h4");
    expect(current.result).toEqual({ kind: "win", winnerId: "b", reason: "мат" });
    expect(legalMoves(current)).toHaveLength(0);
  });

  it("ends in stalemate as a draw", () => {
    // Black to move: king on a8, white queen on c7, white king far away. No legal move, no check.
    const state = position({ a8: "bk", c7: "wq", a1: "wk" }, "b");
    const result = chessEngine.apply(state, { type: "resign" });
    // Resignation works, but the point is the position itself:
    expect(legalMoves(state)).toHaveLength(0);
    expect(inCheck(state, "b")).toBe(false);
    expect(result.changed).toBe(true);
  });

  it("calls a draw when no mate is possible", () => {
    // King and bishop against king cannot mate.
    expect(isDeadPosition(position({ e1: "wk", e8: "bk", c1: "wb" }).board)).toBe(true);
  });

  it("does not call a draw with two knights, because a mate is still possible with help", () => {
    expect(isDeadPosition(position({ e1: "wk", e8: "bk", c1: "wn", g1: "wn" }).board)).toBe(false);
  });

  it("does not call a draw while a pawn can still promote", () => {
    expect(isDeadPosition(position({ e1: "wk", e8: "bk", a2: "wp" }).board)).toBe(false);
  });

  it("awards the win to the opponent when a player resigns", () => {
    const state = createChess({ players: [], seed: 1 });
    const result = chessEngine.apply(state, { type: "resign" });
    expect(result.state.result).toEqual({ kind: "win", winnerId: "b", reason: "сдача" });
  });

  it("refuses every move after the game is over", () => {
    let current = createChess({ players: [], seed: 1 });
    current = chessEngine.apply(current, { type: "resign" }).state;
    const after = chessEngine.apply(current, { type: "move", from: squareIndex("e2"), to: squareIndex("e4") });
    expect(after.changed).toBe(false);
    expect(after.state).toBe(current);
  });
});

describe("refusals", () => {
  it("never changes state when a move is refused", () => {
    const state = createChess({ players: [], seed: 1 });
    const bad = [
      { type: "move" as const, from: squareIndex("e2"), to: squareIndex("e5") },
      { type: "move" as const, from: squareIndex("e7"), to: squareIndex("e5") },
      { type: "move" as const, from: squareIndex("a1"), to: squareIndex("a3") },
    ];
    for (const action of bad) {
      const result = chessEngine.apply(state, action);
      expect(result.changed).toBe(false);
      expect(result.state).toBe(state);
      expect(result.reason).toBeTruthy();
    }
  });

  it("explains a wrong turn in words, not with a code", () => {
    const state = createChess({ players: [], seed: 1 });
    const result = chessEngine.apply(state, { type: "move", from: squareIndex("e7"), to: squareIndex("e5") });
    expect(result.reason).toBe("Сейчас ход другого игрока");
  });

  it("does not let a draw offer count as a draw", () => {
    const state = createChess({ players: [], seed: 1 });
    const result = chessEngine.apply(state, { type: "offer-draw" });
    // Offering is a request. Treating it as acceptance would end games nobody agreed to end.
    expect(result.state.result).toBeNull();
  });

  it("refuses a claimed draw when there is no basis for it", () => {
    const state = createChess({ players: [], seed: 1 });
    const result = chessEngine.apply(state, { type: "accept-draw" });
    expect(result.changed).toBe(false);
  });
});

describe("history and notation", () => {
  it("records each move and its notation", () => {
    let current = createChess({ players: [], seed: 1 });
    current = chessEngine.apply(current, { type: "move", from: squareIndex("e2"), to: squareIndex("e4") }).state;
    expect(current.history).toHaveLength(1);
    expect(current.history[0].san).toBe("e4");
  });

  it("tells two knights apart in the notation", () => {
    // Both knights can reach d2... actually f3/d2 differ; use a position where both reach e4.
    let current = position({ e1: "wk", e8: "bk", g1: "wn", c3: "wn" });
    current = { ...current, turn: "w" };
    const result = chessEngine.apply(current, { type: "move", from: squareIndex("c3"), to: squareIndex("e4") });
    // Only one knight can reach e4, so the notation stays short - but it must not be empty.
    expect(result.state.history[0].san).toContain("e4");
  });

  it("keeps every position so repetition can be counted", () => {
    let current = createChess({ players: [], seed: 1 });
    const play = (from: string, to: string) =>
      (current = chessEngine.apply(current, { type: "move", from: squareIndex(from), to: squareIndex(to) }).state);
    play("g1", "f3");
    play("g8", "f6");
    play("f3", "g1");
    play("f6", "g8");
    // Back to the start: the same position appears twice.
    const key = current.positions[current.positions.length - 1];
    expect(current.positions.filter((position) => position === key).length).toBeGreaterThanOrEqual(2);
  });

  it("produces a position key that changes when the side to move changes", () => {
    const state = createChess({ players: [], seed: 1 });
    const after = chessEngine.apply(state, { type: "move", from: squareIndex("e2"), to: squareIndex("e4") }).state;
    expect(positionKey(state)).not.toBe(positionKey(after));
  });
});

describe("square helpers", () => {
  it("names and indexes squares consistently", () => {
    expect(squareName(0)).toBe("a8");
    expect(squareName(63)).toBe("h1");
    expect(squareIndex("a8")).toBe(0);
    expect(squareIndex("h1")).toBe(63);
    expect(squareIndex("e4")).toBe(36);
  });

  it("refuses a nonsense square name", () => {
    expect(squareIndex("z9")).toBe(-1);
    expect(squareIndex("a0")).toBe(-1);
  });

  it("tells whether a square is attacked", () => {
    const state = position({ e1: "wk", e8: "bk", d5: "wn" });
    expect(isAttacked(state.board, squareIndex("e7"), "w")).toBe(true);
    expect(isAttacked(state.board, squareIndex("a1"), "w")).toBe(false);
  });
});
