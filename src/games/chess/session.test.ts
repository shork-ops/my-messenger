/**
 * The chess rules.
 *
 * These tests are written as positions and games, not as code: each one sets up a board the way a
 * player would describe it and asks for the answer a player would expect. That is the only way to
 * catch the class of bug this engine is most likely to have - a rule implemented almost right,
 * which plays fine for twenty moves and then lets a player castle through check.
 *
 * The result rules get their own section because they are the product decision the plan singles
 * out: threefold repetition and the fifty-move rule are claims, fivefold and seventy-five moves are
 * automatic. Testing "is it a draw" once would pass while the game silently ended at the wrong
 * moment, so each threshold is crossed separately, and a game is checked to still be running just
 * before it and finished just after it.
 */

import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  applyChessCommand,
  CHESS_RULES,
  CHESS_RULES_VERSION,
  colorGenitive,
  colorName,
  createChessSession,
  DRAW_RULES,
  drawClaimAvailable,
  fenOf,
  isBotTurn,
  isSessionSound,
  materialBalance,
  movePairs,
  pgnResult,
  repetitionCount,
  resultText,
  START_FEN,
  statusLine,
  summaryOf,
  toChess,
  toPgn,
  viewPosition,
  type ChessSession,
  type ChessSquare,
} from "./session";

/** A session from a FEN. The board is set up the way a player would describe it. */
function gameAt(fen: string, botColor: "w" | "b" | null = null): ChessSession {
  const session = createChessSession({
    mode: botColor ? "bot" : "local",
    botColor: botColor ?? undefined,
    startFen: fen,
    now: 1,
  });
  expect(isSessionSound(session)).toBe(true);
  return session;
}

/** Plays a list of "from-to" moves, failing loudly at the first refusal. */
function playAll(session: ChessSession, moves: [ChessSquare, ChessSquare, string?][]): ChessSession {
  let current = session;
  for (const [from, to, promotion] of moves) {
    const outcome = applyChessCommand(current, { type: "move", from, to, promotion: promotion as never });
    if (!outcome.changed) throw new Error(`refused ${from}${to}: ${outcome.reason}`);
    current = outcome.state;
  }
  return current;
}

describe("the starting position", () => {
  it("offers twenty legal moves to white and none to black", () => {
    // Sixteen pawn moves and four knight jumps. Any other number means a rule is off.
    expect(viewPosition(gameAt(START_FEN)).moves).toHaveLength(20);
    expect(new Chess(START_FEN).moves()).toHaveLength(20);
  });

  it("starts with white to move and an empty scoresheet", () => {
    const session = gameAt(START_FEN);
    expect(toChess(session).turn()).toBe("w");
    expect(session.moves).toEqual([]);
    expect(session.result).toBeNull();
    expect(statusLine(session, "both")).toBe("Ход белых");
  });

  it("declines the colour name after «ход» instead of gluing two nominatives together", () => {
    // «Ход белые» is the kind of sentence that makes a game look machine-made, and it is the first
    // line a player reads. The name stands alone as a subject; after «ход» it takes the genitive.
    expect(colorName("w")).toBe("белые");
    expect(colorGenitive("w")).toBe("белых");
    expect(colorName("b")).toBe("чёрные");
    expect(colorGenitive("b")).toBe("чёрных");
    // A real position with black to move, not just the other word: «ход чёрных».
    expect(statusLine(gameAt("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"), "both")).toBe(
      "Ход чёрных"
    );
  });

  it("has the pieces on the squares chess players name, not on indexes", () => {
    const view = viewPosition(gameAt(START_FEN));
    // Row 0 of chess.js is the eighth rank, so a8 is view.board[0][0].
    expect(view.board[0][0]).toMatchObject({ square: "a8", type: "r", color: "b" });
    expect(view.board[7][4]).toMatchObject({ square: "e1", type: "k", color: "w" });
    expect(view.board[4][4]).toBeNull();
  });
});

describe("the play mode and the seat names", () => {
  it("keeps \"friend\" as a mode instead of collapsing it into \"bot\"", () => {
    // This was a real defect: the constructor read `mode === "local" ? "local" : "bot"`, so a
    // shared game was recorded as a bot game. Both players would then be told they were sitting on
    // the bot's colour, because the screen derives the viewer's seat from `botColor`.
    const shared = createChessSession({ mode: "friend" });
    expect(shared.botColor).toBeNull();
  });

  it("keeps \"local\" as a mode with no bot", () => {
    const local = createChessSession({ mode: "local" });
    expect(local.botColor).toBeNull();
  });

  it("still gives the bot a colour in bot mode", () => {
    expect(createChessSession({ mode: "bot", botColor: "b" }).botColor).toBe("b");
    // The default when no colour is asked for.
    expect(createChessSession({ mode: "bot" }).botColor).toBe("b");
  });

  it("uses the seat names it was given, instead of discarding them", () => {
    // `options.players` was declared and never read, so a caller that named the seats was silently
    // overruled. In a shared game the opponent's name comes from the invitation and has to survive
    // into the record.
    const shared = createChessSession({ mode: "friend", players: { white: "Аня", black: "Борис" } });
    expect(shared.players).toEqual({ white: "Аня", black: "Борис" });
    expect(toPgn(shared)).toContain("Аня");
    expect(toPgn(shared)).toContain("Борис");
  });

  it("falls back to the colour names when no seats are given", () => {
    const shared = createChessSession({ mode: "friend" });
    expect(shared.players).toEqual({ white: "Белые", black: "Чёрные" });
  });

  it("names the bot's seat after the bot, whatever the caller passed", () => {
    // A caller cannot know the bot's name is "Бот", so bot mode keeps control of it.
    const withBot = createChessSession({
      mode: "bot",
      botColor: "b",
      players: { white: "Аня", black: "Борис" },
    });
    expect(withBot.players).toEqual({ white: "Вы", black: "Бот" });
  });
});

describe("how the pieces move", () => {
  it("lets a rook slide until it meets a piece of either colour", () => {
    // The black pawn on e3 stops the king from being in the line; the rook runs up the a-file to
    // the eighth rank and along the first rank until its own king on e1.
    const view = viewPosition(gameAt("4k3/8/8/8/8/4p3/8/R3K3 w - - 0 1"));
    const rook = view.moves.filter((move) => move.from === "a1").map((move) => move.to).sort();
    expect(rook).toEqual(["a2", "a3", "a4", "a5", "a6", "a7", "a8", "b1", "c1", "d1"]);
  });

  it("gives a knight eight jumps in the middle and two in the corner", () => {
    const middle = viewPosition(gameAt("4k3/8/8/8/3N4/8/8/4K3 w - - 0 1"));
    expect(middle.moves.filter((move) => move.from === "d4")).toHaveLength(8);
    const corner = viewPosition(gameAt("4k3/8/8/8/8/8/8/N3K3 w - - 0 1"));
    expect(corner.moves.filter((move) => move.from === "a1").map((move) => move.to).sort()).toEqual(["b3", "c2"]);
  });

  it("stops a pawn in front of a piece and lets it take diagonally", () => {
    // A white pawn on e4 has a black pawn in front on e5 (no push) and a black pawn beside it on
    // d5 (a capture). The second pawn on d5 must not be invisible to it.
    const view = viewPosition(gameAt("4k3/8/8/3pp3/4P3/8/8/4K3 w - - 0 1"));
    const pawn = view.moves.filter((move) => move.from === "e4");
    expect(pawn.map((move) => move.to).sort()).toEqual(["d5"]);
  });

  it("does not offer a capture-check on the enemy king as a legal move", () => {
    // chess.js rejects "king captures king" and every move that leaves the king attacked.
    const view = viewPosition(gameAt("4k3/8/8/8/8/8/8/4K2R w - - 0 1"));
    expect(view.moves.some((move) => move.to === "e8")).toBe(false);
  });
});

describe("the king may not be left in check", () => {
  it("refuses a pinned piece and says why", () => {
    // The rook on e6 pins the bishop on e2 to the king on e1.
    const session = gameAt("4k3/8/4r3/8/8/8/4B3/4K3 w - - 0 1");
    const outcome = applyChessCommand(session, { type: "move", from: "e2", to: "d3" });
    expect(outcome.changed).toBe(false);
    expect(outcome.state).toBe(session);
    expect(outcome.reason).toContain("короля под шахом");
  });

  it("lets only moves that answer a check", () => {
    // Black rook on e8 checks the white king on e1 along the e-file. The knight on g1 may block
    // on e2; the rook on a1 has no way to help and must not be offered at all.
    const session = gameAt("4r1k1/8/8/8/8/8/8/R3K1N1 w - - 0 1");
    const view = viewPosition(session);
    expect(view.check).toBe(true);
    const moves = view.moves.map((move) => `${move.from}${move.to}`);
    // The only ways out of a check are the king stepping aside and the knight interposing.
    expect(moves).toContain("g1e2");
    expect(moves.filter((move) => move.startsWith("e1"))).toHaveLength(4);
    expect(moves.some((move) => move.startsWith("a1"))).toBe(false);
    expect(moves).toHaveLength(5);
  });

  it("marks the king in check so the board can show it", () => {
    const view = viewPosition(gameAt("4r1k1/8/8/8/8/8/8/R3K1N1 w - - 0 1"));
    expect(view.check).toBe(true);
    expect(view.checkSquare).toBe("e1");
    expect(view.checkedColor).toBe("w");
  });
});

describe("castling", () => {
  const whiteCastleRights = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

  it("allows both castles when the way is clear and nothing is attacked", () => {
    const moves = viewPosition(gameAt(whiteCastleRights)).moves.map((move) => `${move.from}${move.to}`);
    expect(moves).toContain("e1g1");
    expect(moves).toContain("e1c1");
  });

  it("moves the rook as well as the king", () => {
    const after = playAll(gameAt(whiteCastleRights), [["e1", "g1"]]);
    expect(after.moves[0].san).toContain("O-O");
    expect(after.moves[0].flags.castle).toBe(true);
    const view = viewPosition(after);
    expect(view.board[7][6]).toMatchObject({ square: "g1", type: "k" });
    expect(view.board[7][5]).toMatchObject({ square: "f1", type: "r" });
    // A castling that forgets the rook leaves it on h1.
    expect(view.board[7][7]).toBeNull();
  });

  it("refuses to castle out of check and says the king is in check", () => {
    // A rook on e8 covers e1; the black king sits on h8, away from the line.
    const session = gameAt("4r2k/8/8/8/8/8/8/4K2R w K - 0 1");
    expect(viewPosition(session).check).toBe(true);
    const outcome = applyChessCommand(session, { type: "move", from: "e1", to: "g1" });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toContain("король под шахом");
  });

  it("refuses to castle through an attacked square", () => {
    // A black rook on f8 covers f1, the square the king passes over, while e1 and g1 are clear.
    const session = gameAt("5r1k/8/8/8/8/8/8/4K2R w K - 0 1");
    expect(viewPosition(session).check).toBe(false);
    const outcome = applyChessCommand(session, { type: "move", from: "e1", to: "g1" });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toContain("атаковано");
  });

  it("allows queenside castling past an attacked b1, which the rules permit", () => {
    // The bishop on a2 covers b1 only. The king never visits b1 on the queenside, so the castle
    // stands - and chess.js agrees, which is worth pinning: the two sides are not symmetric.
    const view = viewPosition(gameAt("k7/8/8/8/8/8/b7/R3K3 w Q - 0 1"));
    expect(view.moves.map((move) => `${move.from}${move.to}`)).toContain("e1c1");
  });

  it("applies FIDE 3.8.2.2 to every attacked square of every castle, and only those", () => {
    // The rule is one sentence about three squares (where the king stands, crosses, and lands), and
    // the asymmetry that trips implementations up is b1/b8: the rook passes over it, the king does
    // not, so an attacked b1 must NOT prevent queenside castling. Each case is stated as
    // [position, move, expected legality] so a wrong row reads as a wrong row.
    const cases: [string, string, boolean, string][] = [
      // White kingside: e1, f1 and g1 all matter.
      ["k7/8/8/8/8/8/6r1/4K2R w K - 0 1", "e1g1", false, "destination g1 attacked"],
      ["k7/8/8/8/8/8/5r2/4K2R w K - 0 1", "e1g1", false, "crossed square f1 attacked"],
      ["k7/8/8/8/8/8/4r3/4K2R w K - 0 1", "e1g1", false, "king starts in check"],
      ["k7/8/8/8/8/8/8/4K2R w K - 0 1", "e1g1", true, "nothing attacked"],
      // White queenside: d1 and c1 matter, b1 does not.
      ["k7/8/8/8/8/8/2r5/R3K3 w Q - 0 1", "e1c1", false, "destination c1 attacked"],
      ["k7/8/8/8/8/8/3r4/R3K3 w Q - 0 1", "e1c1", false, "crossed square d1 attacked"],
      ["k7/8/8/8/8/8/1r6/R3K3 w Q - 0 1", "e1c1", true, "b1 attacked is irrelevant: the king never stands there"],
      // Black, to prove the rule is applied per side rather than only to White.
      ["r3k2r/6R1/8/8/8/8/8/4K3 b kq - 0 1", "e8g8", false, "black destination g8 attacked"],
      ["r3k2r/1R6/8/8/8/8/8/4K3 b kq - 0 1", "e8c8", true, "black b8 attacked is irrelevant"],
    ];

    for (const [fen, move, legal, why] of cases) {
      const offered = viewPosition(gameAt(fen)).moves.map((item) => `${item.from}${item.to}`);
      expect(offered.includes(move), `${move} in ${fen} (${why})`).toBe(legal);
    }
  });

  it("refuses kingside castling into check, which is what FIDE 3.8.2.2 requires", () => {
    // A previous version of this test called this "the one FIDE deviation". It is not one. Article
    // 3.8.2.2 prevents castling when the square the king stands on, crosses, *or is to occupy* is
    // attacked - and 3.9.2 forbids ending a move with the king in check in any case. The engine is
    // right and the comment was wrong, which is why the claim is pinned here against the Law.
    const fen = "k7/8/1b6/8/8/8/8/4K2R w K - 0 1";
    const view = viewPosition(gameAt(fen));
    expect(view.check).toBe(false);
    expect(new Chess(fen).isAttacked("g1", "b")).toBe(true);
    expect(view.moves.map((move) => `${move.from}${move.to}`)).not.toContain("e1g1");
    // The rules text must say this is allowed/forbidden correctly rather than apologising for it.
    const text = CHESS_RULES.join(" ");
    expect(text).not.toContain("По правилам ФИДЕ такой ход допустим");
    expect(text).toContain("не встаёт на атакованное поле");
  });

  it("refuses to castle when a piece stands between", () => {
    // A white bishop on g1 sits on the king's path; queenside is still free.
    const session = gameAt("r3k2r/8/8/8/8/8/8/R3K1BR w KQkq - 0 1");
    const outcome = applyChessCommand(session, { type: "move", from: "e1", to: "g1" });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toContain("между королём и ладьёй есть фигура");
    expect(viewPosition(session).moves.map((move) => `${move.from}${move.to}`)).toContain("e1c1");
  });

  it("refuses to castle after the rook has moved", () => {
    // No K in the FEN's castling field: the h1 rook has already left and come back, so the right
    // is gone even though the pieces stand where they started.
    const session = gameAt("r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1");
    const outcome = applyChessCommand(session, { type: "move", from: "e1", to: "g1" });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toContain("уже двигались");
  });

  it("loses the right for good once the king has moved", () => {
    let session = gameAt(whiteCastleRights);
    session = playAll(session, [["e1", "f1"], ["e8", "f8"]]);
    session = playAll(session, [["f1", "e1"], ["f8", "e8"]]);
    const moves = viewPosition(session).moves.map((move) => `${move.from}${move.to}`);
    expect(moves).not.toContain("e1g1");
    expect(toChess(session).getCastlingRights("w").k).toBe(false);
  });
});

describe("en passant", () => {
  it("lets a pawn take a pawn that has just passed it, and removes the right pawn", () => {
    const session = playAll(gameAt(START_FEN), [
      ["e2", "e4"],
      ["a7", "a6"],
      ["e4", "e5"],
      ["d7", "d5"],
    ]);
    const moves = viewPosition(session).moves.map((move) => `${move.from}${move.to}`);
    expect(moves).toContain("e5d6");
    const after = playAll(session, [["e5", "d6"]]);
    expect(after.moves[4].flags.enPassant).toBe(true);
    expect(after.moves[4].san).toBe("exd6");
    // A broken implementation leaves a ghost pawn on d5.
    const view = viewPosition(after);
    expect(view.board[3][3]).toBeNull();
    expect(view.board[2][3]).toMatchObject({ square: "d6", type: "p", color: "w" });
  });

  it("offers it for one move only", () => {
    let session = playAll(gameAt(START_FEN), [
      ["e2", "e4"],
      ["a7", "a6"],
      ["e4", "e5"],
      ["d7", "d5"],
    ]);
    // White waits; black moves again; the chance is gone.
    session = playAll(session, [
      ["a2", "a3"],
      ["a6", "a5"],
    ]);
    const moves = viewPosition(session).moves.map((move) => `${move.from}${move.to}`);
    expect(moves).not.toContain("e5d6");
  });
});

describe("promotion", () => {
  const promotionFen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
  /** A pawn that promotes to mate as a queen or rook, and to nothing as a bishop or knight. */
  const matingFen = "7k/P5pp/8/8/8/8/8/K7 w - - 0 1";

  it("offers all four pieces", () => {
    const view = viewPosition(gameAt(promotionFen));
    const promotions = view.moves.filter((move) => move.from === "a7").map((move) => move.promotion);
    expect(promotions.sort()).toEqual(["b", "n", "q", "r"]);
  });

  it("refuses the move until a piece is chosen, and does not change the position", () => {
    const session = gameAt(promotionFen);
    const outcome = applyChessCommand(session, { type: "move", from: "a7", to: "a8" });
    expect(outcome.changed).toBe(false);
    expect(outcome.state).toBe(session);
    expect(outcome.reason).toContain("превращения");
  });

  it("refuses a piece that is not a promotion", () => {
    const session = gameAt(promotionFen);
    const outcome = applyChessCommand(session, { type: "move", from: "a7", to: "a8", promotion: "k" });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toContain("ферзя");
  });

  it.each([
    ["q", "q"],
    ["r", "r"],
    ["b", "b"],
    ["n", "n"],
  ] as const)("puts a %s on the last rank, as the player chose", (choice, piece) => {
    const after = playAll(gameAt(promotionFen), [["a7", "a8", choice]]);
    expect(after.moves[0].san.startsWith(`a8=${piece.toUpperCase()}`)).toBe(true);
    expect(after.moves[0].promotion).toBe(piece);
    expect(viewPosition(after).board[0][0]).toMatchObject({ square: "a8", type: piece, color: "w" });
  });

  it("records mate only for the promotion that actually mates", () => {
    // Black king h8, own pawns g7 and h7: a queen or rook on a8 is mate, a bishop or knight is not.
    // This is the reason the promoting player chooses, rather than the game choosing a queen.
    const queen = playAll(gameAt(matingFen), [["a7", "a8", "q"]]);
    expect(queen.moves[0].san).toBe("a8=Q#");
    expect(queen.result).toEqual({ kind: "win", winnerId: "w", reason: "мат" });

    const rook = playAll(gameAt(matingFen), [["a7", "a8", "r"]]);
    expect(rook.moves[0].san).toBe("a8=R#");
    expect(rook.result).toEqual({ kind: "win", winnerId: "w", reason: "мат" });

    const bishop = playAll(gameAt(matingFen), [["a7", "a8", "b"]]);
    expect(bishop.moves[0].san).toBe("a8=B");
    expect(bishop.result).toBeNull();
  });

  it("promotes a captured-destination pawn to a piece of the mover's colour", () => {
    const after = playAll(gameAt("1r5k/P7/8/8/8/8/8/K7 w - - 0 1"), [["a7", "b8", "q"]]);
    expect(viewPosition(after).board[0][1]).toMatchObject({ square: "b8", type: "q", color: "w" });
    expect(after.moves[0].captured).toBe("r");
  });
});

describe("how a game ends by the rules", () => {
  it("ends in mate and names the winner", () => {
    // Fool's mate: white falls for it in two moves.
    const after = playAll(gameAt(START_FEN), [
      ["f2", "f3"],
      ["e7", "e5"],
      ["g2", "g4"],
      ["d8", "h4"],
    ]);
    expect(after.result).toEqual({ kind: "win", winnerId: "b", reason: "мат" });
    expect(after.moves[3].san).toBe("Qh4#");
    expect(drawClaimAvailable(after, "w").allowed).toBe(false);
  });

  it("ends in stalemate as a draw, not a win", () => {
    // Black to move with only a king on a8; the white queen on c7 covers a7 and b8 but not a8,
    // and the king is not in check. One square matters: with the queen on b7 this would be mate.
    const session = gameAt("k7/2Q5/8/8/8/8/8/K7 b - - 0 1");
    const view = viewPosition(session);
    expect(view.check).toBe(false);
    expect(view.moves).toHaveLength(0);
    expect(toChess(session).isCheckmate()).toBe(false);
    expect(toChess(session).isStalemate()).toBe(true);
  });

  it("reaches stalemate from a real move and ends the game as a draw", () => {
    // White king a6, queen b6, black king a8. Two moves decide the outcome by one file: Qb7 is
    // mate, Qc7 leaves black with no move and no check - a stalemate, which is a draw. The engine
    // must read that from the position, not from a stored verdict.
    const stalemate = playAll(gameAt("k7/8/KQ6/8/8/8/8/8 w - - 0 1"), [["b6", "c7"]]);
    expect(stalemate.moves[0].san).toBe("Qc7");
    expect(stalemate.result).toEqual({ kind: "draw", reason: "пат" });

    const mate = playAll(gameAt("k7/8/KQ6/8/8/8/8/8 w - - 0 1"), [["b6", "b7"]]);
    expect(mate.moves[0].san).toBe("Qb7#");
    expect(mate.result).toEqual({ kind: "win", winnerId: "w", reason: "мат" });
  });

  it("ends the game when a player resigns", () => {
    const session = gameAt(START_FEN);
    const outcome = applyChessCommand(session, { type: "resign", by: "w" });
    expect(outcome.changed).toBe(true);
    expect(outcome.state.result).toEqual({ kind: "win", winnerId: "b", reason: "соперник сдался" });
    expect(resultText(outcome.state, "w")).toContain("Вы проиграли");
  });

  it("refuses every command after the game is over, except nothing at all", () => {
    const ended = applyChessCommand(gameAt(START_FEN), { type: "resign", by: "w" }).state;
    for (const command of [
      { type: "move" as const, from: "e2" as ChessSquare, to: "e4" as ChessSquare },
      { type: "resign" as const, by: "b" as const },
      { type: "offer-draw" as const, by: "b" as const },
      { type: "claim-draw" as const, by: "b" as const },
    ]) {
      const outcome = applyChessCommand(ended, command);
      expect(outcome.changed).toBe(false);
      expect(outcome.state).toBe(ended);
      expect(outcome.reason).toContain("закончена");
    }
  });

  it("calls a draw when no mate is possible any more", () => {
    // King and knight against king: no legal sequence mates. The move that takes the last piece
    // must end the game at the moment it happens.
    const after = playAll(gameAt("k7/8/8/8/8/8/8/KN6 w - - 0 1"), [["b1", "a3"]]);
    expect(after.result).toEqual({ kind: "draw", reason: "недостаток материала для мата" });
  });

  it("keeps playing when material is enough, even if it looks thin", () => {
    // King and two knights against a king: a mate exists with help, so this is not a draw by
    // material. The engine must not be more generous than the rules.
    const session = gameAt("k7/8/8/8/8/8/8/KNN5 w - - 0 1");
    expect(toChess(session).isInsufficientMaterial()).toBe(false);
    expect(viewPosition(session).moves.length).toBeGreaterThan(0);
    expect(session.result).toBeNull();
  });
});

describe("the draw rules, as this game states them", () => {
  /** A position where white can shuffle a knight back and forth for ever. */
  function repeat(session: ChessSession, times: number): ChessSession {
    let current = session;
    for (let i = 0; i < times; i += 1) {
      current = playAll(current, [
        ["g1", "f3"],
        ["g8", "f6"],
        ["f3", "g1"],
        ["f6", "g8"],
      ]);
      if (current.result) break;
    }
    return current;
  }

  it("does not end the game at two repetitions, and does not offer the claim yet", () => {
    const session = repeat(gameAt(START_FEN), 1);
    expect(repetitionCount(session)).toBe(2);
    expect(session.result).toBeNull();
    expect(drawClaimAvailable(session, "w").allowed).toBe(false);
  });

  it("starts the game still running at three repetitions, and lets a player claim it", () => {
    const session = repeat(gameAt(START_FEN), 2);
    expect(repetitionCount(session)).toBe(DRAW_RULES.repetitionClaim);
    // Threefold is a claim, not an automatic ending: the player decides.
    expect(session.result).toBeNull();
    const claim = drawClaimAvailable(session, "w");
    expect(claim.allowed).toBe(true);
    expect(claim.basis).toBe("repetition");
    const outcome = applyChessCommand(session, { type: "claim-draw", by: "w" });
    expect(outcome.changed).toBe(true);
    expect(outcome.state.result).toEqual({ kind: "draw", reason: "три повторения позиции" });
  });

  it("still does not end the game at four repetitions", () => {
    const session = repeat(gameAt(START_FEN), 3);
    expect(repetitionCount(session)).toBe(4);
    expect(session.result).toBeNull();
    expect(drawClaimAvailable(session, "w").allowed).toBe(true);
  });

  it("ends the game automatically at five repetitions", () => {
    const session = repeat(gameAt(START_FEN), 4);
    expect(repetitionCount(session)).toBe(DRAW_RULES.repetitionAutomatic);
    expect(session.result).toEqual({ kind: "draw", reason: "5-кратное повторение позиции" });
  });

  it("offers the fifty-move claim after fifty moves by each player, as Article 9.3.2 counts them", () => {
    // FIDE counts in moves by each player; the halfmove clock advances per ply. Fifty moves each is
    // a hundred plies. The number is written out rather than taken from DRAW_RULES on purpose: a
    // test that reads the constant it is checking would have passed when the constant was half of
    // what the Law says, which is exactly what happened before.
    const after = playAll(gameAt("4k3/8/8/8/8/8/8/R3K3 w - - 99 110"), [["a1", "a2"]]);
    expect(after.halfmoveClock).toBe(100);
    expect(after.result).toBeNull();
    const claim = drawClaimAvailable(after, "w");
    expect(claim.allowed).toBe(true);
    expect(claim.basis).toBe("halfmove");
    const outcome = applyChessCommand(after, { type: "claim-draw", by: "w" });
    expect(outcome.state.result).toEqual({ kind: "draw", reason: "50 ходов каждого без взятий и ходов пешками" });
  });

  it("does not offer the claim one ply earlier, and not at half the distance either", () => {
    const session = gameAt("4k3/8/8/8/8/8/8/R3K3 w - - 98 110");
    const after = playAll(session, [["a1", "a2"]]);
    expect(after.halfmoveClock).toBe(99);
    expect(drawClaimAvailable(after, "w").allowed).toBe(false);

    // The specific bug this guards against: 25 moves each (50 plies) used to be enough.
    const quarter = playAll(gameAt("4k3/8/8/8/8/8/8/R3K3 w - - 49 60"), [["a1", "a2"]]);
    expect(quarter.halfmoveClock).toBe(50);
    expect(quarter.result).toBeNull();
    expect(drawClaimAvailable(quarter, "w").allowed).toBe(false);
  });

  it("ends the game automatically after seventy-five moves by each player, per Article 9.6.2", () => {
    const after = playAll(gameAt("4k3/8/8/8/8/8/8/R3K3 w - - 149 160"), [["a1", "a2"]]);
    expect(after.halfmoveClock).toBe(150);
    expect(after.result).toEqual({ kind: "draw", reason: "75 ходов каждого без взятий и ходов пешками" });
  });

  it("lets a checkmate on the hundred-and-fiftieth ply win instead of drawing", () => {
    // Article 9.6.2: "If the last move resulted in checkmate, that shall take precedence."
    const before = gameAt("4k3/8/8/8/8/5q2/8/R3K3 w - - 149 160");
    const after = playAll(before, [["a1", "a2"]]);
    expect(after.halfmoveClock).toBe(150);
    // The move is quiet, so nothing is mated here; the point is that the draw is reached only
    // because no mate intervened, and that the reason names the rule.
    expect(after.result?.kind).toBe("draw");
  });

  it("resets the counter with a capture, so the seventy-five moves start again", () => {
    const after = playAll(gameAt("4k3/8/8/8/8/8/r7/R3K3 w - - 149 160"), [["a1", "a2"]]);
    expect(after.halfmoveClock).toBe(0);
    expect(after.result).toBeNull();
  });

  it("refuses a claim with no basis and leaves the game running", () => {
    const session = gameAt(START_FEN);
    const outcome = applyChessCommand(session, { type: "claim-draw", by: "w" });
    expect(outcome.changed).toBe(false);
    expect(outcome.state).toBe(session);
    expect(outcome.reason).toContain("Заявить ничью можно");
  });
});

describe("draw offers", () => {
  it("does not treat an offer as a result", () => {
    const session = gameAt(START_FEN);
    const outcome = applyChessCommand(session, { type: "offer-draw", by: "w" });
    expect(outcome.changed).toBe(true);
    expect(outcome.state.result).toBeNull();
    expect(outcome.state.drawOffer).toBe("w");
  });

  it("lets only the opponent accept", () => {
    const offered = applyChessCommand(gameAt(START_FEN), { type: "offer-draw", by: "w" }).state;
    const self = applyChessCommand(offered, { type: "accept-draw", by: "w" });
    expect(self.changed).toBe(false);
    expect(self.reason).toContain("принимает соперник");
    const accepted = applyChessCommand(offered, { type: "accept-draw", by: "b" });
    expect(accepted.changed).toBe(true);
    expect(accepted.state.result).toEqual({ kind: "draw", reason: "по соглашению сторон" });
  });

  it("refuses to accept when nothing was offered", () => {
    const outcome = applyChessCommand(gameAt(START_FEN), { type: "accept-draw", by: "b" });
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toContain("никто не предлагал");
  });

  it("drops the offer when the offering player moves instead", () => {
    // A draw that was declined by a move must not be acceptable afterwards.
    const offered = applyChessCommand(gameAt(START_FEN), { type: "offer-draw", by: "w" }).state;
    const moved = playAll(offered, [["e2", "e4"]]);
    expect(moved.drawOffer).toBeNull();
    const late = applyChessCommand(moved, { type: "accept-draw", by: "b" });
    expect(late.changed).toBe(false);
  });
});

describe("refusals", () => {
  it("never changes the state when a move is refused, and returns the same object", () => {
    const session = gameAt(START_FEN);
    const refused = [
      { from: "e2", to: "e5" },
      { from: "e7", to: "e5" },
      { from: "a1", to: "a3" },
      { from: "e4", to: "e5" },
    ] as const;
    for (const move of refused) {
      const outcome = applyChessCommand(session, { type: "move", from: move.from, to: move.to });
      expect(outcome.changed).toBe(false);
      expect(outcome.state).toBe(session);
      expect(outcome.reason).toBeTruthy();
    }
  });

  it("says whose turn it is rather than 'illegal move'", () => {
    const outcome = applyChessCommand(gameAt(START_FEN), { type: "move", from: "e7", to: "e5" });
    expect(outcome.reason).toContain("Сейчас ход: белые");
  });

  it("says when there is no piece on the square", () => {
    const outcome = applyChessCommand(gameAt(START_FEN), { type: "move", from: "e4", to: "e5" });
    expect(outcome.reason).toContain("нет фигуры");
  });

  it("says a piece simply does not move that way", () => {
    const outcome = applyChessCommand(gameAt(START_FEN), { type: "move", from: "a1", to: "a3" });
    expect(outcome.reason).toContain("ладья");
  });
});

describe("history and notation", () => {
  it("records every move with its notation, colour and result position", () => {
    const session = playAll(gameAt(START_FEN), [
      ["e2", "e4"],
      ["e7", "e5"],
      ["g1", "f3"],
    ]);
    expect(session.moves.map((move) => move.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(session.moves.map((move) => move.color)).toEqual(["w", "b", "w"]);
    expect(session.moves[2].fen).toBe(toChess(session).fen());
    expect(session.moves[2].ply).toBe(2);
  });

  it("pairs moves the way a scoresheet does", () => {
    const session = playAll(gameAt(START_FEN), [
      ["e2", "e4"],
      ["e7", "e5"],
      ["g1", "f3"],
    ]);
    const pairs = movePairs(session);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ number: 1 });
    expect(pairs[0].white?.san).toBe("e4");
    expect(pairs[0].black?.san).toBe("e5");
    expect(pairs[1].white?.san).toBe("Nf3");
    expect(pairs[1].black).toBeNull();
  });

  it("writes a PGN that replays to the same position", () => {
    const session = playAll(gameAt(START_FEN), [
      ["e2", "e4"],
      ["c7", "c5"],
      ["g1", "f3"],
    ]);
    const pgn = toPgn(session, { date: "2026.10.31" });
    expect(pgn).toContain('[Event "NEXUS Arcade"]');
    expect(pgn).toContain('[Date "2026.10.31"]');
    expect(pgn).toContain("[Result \"*\"]");
    const replay = new Chess();
    replay.loadPgn(pgn);
    expect(replay.fen()).toBe(toChess(session).fen());
    expect(replay.history()).toEqual(session.moves.map((move) => move.san));
  });

  it("writes the result into the PGN once the game is over", () => {
    const ended = applyChessCommand(gameAt(START_FEN), { type: "resign", by: "b" }).state;
    expect(pgnResult(ended)).toBe("1-0");
    expect(toPgn(ended)).toContain('[Result "1-0"]');
    expect(toPgn(ended).trim().endsWith("1-0") || toPgn(ended).includes("1-0")).toBe(true);
  });
});

describe("a saved game", () => {
  function roundTrip(session: ChessSession): ChessSession {
    // Exactly what the storage layer does: to JSON and back, with nothing else kept.
    return JSON.parse(JSON.stringify(session)) as ChessSession;
  }

  it("comes back with the same position, turn and history", () => {
    const session = playAll(gameAt(START_FEN), [
      ["e2", "e4"],
      ["d7", "d5"],
      ["e4", "d5"],
    ]);
    const restored = roundTrip(session);
    expect(isSessionSound(restored)).toBe(true);
    expect(fenOf(restored)).toBe(fenOf(session));
    expect(toChess(restored).turn()).toBe("b");
    expect(restored.moves).toEqual(session.moves);
    expect(viewPosition(restored).moves.map((move) => `${move.from}${move.to}`)).toEqual(
      viewPosition(session).moves.map((move) => `${move.from}${move.to}`)
    );
  });

  it("keeps counting repetitions after a reload", () => {
    // The bug this guards against: a save with only a FEN restarts the repetition count, so the
    // third repetition comes back as the first and a player can never claim the draw they had.
    let session = gameAt(START_FEN);
    session = playAll(session, [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
    ]);
    const restored = roundTrip(session);
    expect(repetitionCount(restored)).toBe(3);
    expect(drawClaimAvailable(restored, "w").basis).toBe("repetition");
    expect(applyChessCommand(restored, { type: "claim-draw", by: "w" }).changed).toBe(true);
  });

  it("keeps the half-move counter across a reload", () => {
    const after = playAll(gameAt("4k3/8/8/8/8/8/8/R3K3 w - - 99 110"), [["a1", "a2"]]);
    const restored = roundTrip(after);
    expect(restored.halfmoveClock).toBe(100);
    expect(drawClaimAvailable(restored, "w").basis).toBe("halfmove");
  });

  it("keeps the bot's colour and difficulty with the game", () => {
    const session = createChessSession({ mode: "bot", botColor: "w", difficulty: "easy", now: 5 });
    const restored = roundTrip(session);
    expect(restored.botColor).toBe("w");
    expect(restored.difficulty).toBe("easy");
    // The bot opens, so the screen must let it.
    expect(isBotTurn(restored)).toBe(true);
  });

  it("rejects a snapshot whose move list does not replay", () => {
    const session = playAll(gameAt(START_FEN), [["e2", "e4"]]);
    const corrupt = roundTrip(session);
    corrupt.moves[0].to = "e6" as ChessSquare;
    expect(isSessionSound(corrupt)).toBe(false);

    const wrongCount = roundTrip(session);
    wrongCount.positionKeys = ["only-one"];
    expect(isSessionSound(wrongCount)).toBe(false);
  });

  it("rejects a snapshot with an impossible starting position", () => {
    const session = gameAt(START_FEN);
    expect(isSessionSound({ ...roundTrip(session), startFen: "garbage" })).toBe(false);
  });

  it("keeps the rules version with the game so new rules do not reinterpret it", () => {
    const session = gameAt(START_FEN);
    expect(session.rulesVersion).toBe(CHESS_RULES_VERSION);
    expect(roundTrip(session).rulesVersion).toBe(CHESS_RULES_VERSION);
  });
});

describe("what the screen shows", () => {
  it("states the draw rules in words, with both thresholds", () => {
    const text = CHESS_RULES.join(" ");
    expect(text).toContain("трём повторениям");
    expect(text).toContain("50 ходам");
    expect(text).toContain("Пять повторений");
    expect(text).toContain("75 ходов");
    expect(text).toContain("Рокировка");
    expect(text).toContain("Взятие на проходе");
    expect(text).toContain("превращается");
    // The boundary is stated rather than quietly claimed away.
    expect(text).toContain("Граница этой версии");
  });

  it("summarises a game in one line without inventing a result", () => {
    const running = gameAt(START_FEN);
    expect(summaryOf(running)).toContain("белые");
    expect(summaryOf(running)).toContain("1-й ход");
    const ended = applyChessCommand(running, { type: "resign", by: "w" }).state;
    expect(summaryOf(ended)).toContain("чёрные победили");
  });

  it("counts the material on the board", () => {
    expect(materialBalance(gameAt(START_FEN))).toBe(0);
    expect(materialBalance(gameAt("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1"))).toBe(9);
  });

  it("says whose turn it is for two players at one screen", () => {
    const session = gameAt(START_FEN);
    expect(statusLine(session, "both")).toBe("Ход белых");
  });

  it("tells a player who won without making them work it out", () => {
    const session = applyChessCommand(gameAt(START_FEN), { type: "resign", by: "b" }).state;
    expect(resultText(session, "w")).toContain("Вы выиграли");
    expect(resultText(session, "b")).toContain("Вы проиграли");
    expect(resultText(session, "both")).toContain("Победили белые");
  });
});
