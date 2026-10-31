/**
 * Chess rules, written out rather than taken from a library.
 *
 * A library would give legal moves in a hundred lines less code. It would not give the things
 * this game actually needs: a position that serialises to a stable shape, a history that
 * survives a reload, and the ability to say exactly why a move was refused. The last one is
 * what a player sees when they try to castle through check, and "illegal move" is not an
 * answer.
 *
 * The board is a flat array of 64, index 0 is a8 and index 63 is h1 - the same order a FEN
 * string uses, so reading a position off screen needs no translation.
 */

import type { ApplyResult, CreateOptions, GameEngine, GameResult, Player } from "../core/types";
import { makeRandom } from "../core/types";

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export type Piece = { color: Color; type: PieceType };

/** A square is an index 0..63, or null for an empty one. */
export type Board = (Piece | null)[];

export type ChessMove = {
  from: number;
  to: number;
  /** Set for a pawn reaching the last rank; the player chooses and this is the choice. */
  promotion?: PieceType;
};

/** One played move, kept so a reload continues rather than restarts. */
export type MoveRecord = {
  move: ChessMove;
  /** The piece that moved, before the move - needed to redraw the captured list. */
  piece: Piece;
  captured: Piece | null;
  /** Algebraic text, for the move list. */
  san: string;
};

export type CastlingRights = { w: { k: boolean; q: boolean }; b: { k: boolean; q: boolean } };

export type ChessState = {
  board: Board;
  turn: Color;
  /** What each side may still castle, given which king and rooks have moved. */
  castling: CastlingRights;
  /** The square a pawn skipped over, available for one move only. */
  enPassant: number | null;
  halfmoveClock: number;
  fullmove: number;
  history: MoveRecord[];
  /** Every position since the start, for threefold repetition. FEN without clocks. */
  positions: string[];
  result: GameResult | null;
  /** The player (by colour) who resigned or agreed a draw, if that is how it ended. */
  endedBy: string | null;
};

export type ChessAction =
  | { type: "move"; from: number; to: number; promotion?: PieceType }
  | { type: "resign" }
  | { type: "offer-draw" }
  | { type: "accept-draw" };

const START_BOARD: Board = [
  { color: "b", type: "r" }, { color: "b", type: "n" }, { color: "b", type: "b" }, { color: "b", type: "q" },
  { color: "b", type: "k" }, { color: "b", type: "b" }, { color: "b", type: "n" }, { color: "b", type: "r" },
  ...Array.from({ length: 8 }, () => ({ color: "b", type: "p" }) as Piece),
  ...Array.from({ length: 32 }, () => null as Piece | null),
  ...Array.from({ length: 8 }, () => ({ color: "w", type: "p" }) as Piece),
  { color: "w", type: "r" }, { color: "w", type: "n" }, { color: "w", type: "b" }, { color: "w", type: "q" },
  { color: "w", type: "k" }, { color: "w", type: "b" }, { color: "w", type: "n" }, { color: "w", type: "r" },
];

export function fileOf(square: number): number {
  return square % 8;
}

export function rankOf(square: number): number {
  return Math.floor(square / 8);
}

/** a8 is 0, so rank 0 is the eighth rank. */
export function squareName(square: number): string {
  return `${"abcdefgh"[fileOf(square)]}${8 - rankOf(square)}`;
}

export function squareIndex(name: string): number {
  const file = "abcdefgh".indexOf(name[0]);
  const rank = 8 - Number(name[1]);
  if (file < 0 || rank < 0 || rank > 7) return -1;
  return rank * 8 + file;
}

export function otherColor(color: Color): Color {
  return color === "w" ? "b" : "w";
}

export function initialState(): ChessState {
  const state: ChessState = {
    board: START_BOARD.slice(),
    turn: "w",
    castling: { w: { k: true, q: true }, b: { k: true, q: true } },
    enPassant: null,
    halfmoveClock: 0,
    fullmove: 1,
    history: [],
    positions: [],
    result: null,
    endedBy: null,
  };
  state.positions = [positionKey(state)];
  return state;
}

/** The position without clocks: the thing repetition is counted over. */
export function positionKey(state: Pick<ChessState, "board" | "turn" | "castling" | "enPassant">): string {
  const pieces = state.board
    .map((piece) => {
      if (!piece) return ".";
      const letter = { p: "p", n: "n", b: "b", r: "r", q: "q", k: "k" }[piece.type];
      return piece.color === "w" ? letter.toUpperCase() : letter;
    })
    .join("");
  const castling =
    `${state.castling.w.k ? "K" : ""}${state.castling.w.q ? "Q" : ""}` +
    `${state.castling.b.k ? "k" : ""}${state.castling.b.q ? "q" : ""}`;
  return `${pieces} ${state.turn} ${castling || "-"} ${state.enPassant === null ? "-" : squareName(state.enPassant)}`;
}

/** The full FEN, for export and for saving. */
export function toFen(state: ChessState): string {
  let rows: string[] = [];
  for (let rank = 0; rank < 8; rank += 1) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = state.board[rank * 8 + file];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      const letter = piece.type;
      row += piece.color === "w" ? letter.toUpperCase() : letter;
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  const castling =
    `${state.castling.w.k ? "K" : ""}${state.castling.w.q ? "Q" : ""}` +
    `${state.castling.b.k ? "k" : ""}${state.castling.b.q ? "q" : ""}`;
  return [
    rows.join("/"),
    state.turn,
    castling || "-",
    state.enPassant === null ? "-" : squareName(state.enPassant),
    String(state.halfmoveClock),
    String(state.fullmove),
  ].join(" ");
}

const KNIGHT_STEPS = [-17, -15, -10, -6, 6, 10, 15, 17];
const KING_STEPS = [-9, -8, -7, -1, 1, 7, 8, 9];
const BISHOP_DIRS = [-9, -7, 7, 9];
const ROOK_DIRS = [-8, -1, 1, 8];

/** Offsets can wrap around the board edge; a step is valid only if the file moves sanely. */
function stepIsValid(from: number, to: number): boolean {
  if (to < 0 || to > 63) return false;
  const df = Math.abs(fileOf(from) - fileOf(to));
  const dr = Math.abs(rankOf(from) - rankOf(to));
  return df <= 2 && dr <= 2;
}

/** Squares a piece attacks, ignoring whether it would expose its own king. */
function pseudoMoves(board: Board, from: number, piece: Piece): number[] {
  const out: number[] = [];
  const add = (to: number) => {
    const target = board[to];
    if (target && target.color === piece.color) return false;
    out.push(to);
    return !target;
  };

  if (piece.type === "n") {
    for (const step of KNIGHT_STEPS) {
      const to = from + step;
      if (stepIsValid(from, to) && Math.abs(fileOf(from) - fileOf(to)) + Math.abs(rankOf(from) - rankOf(to)) === 3) {
        const target = board[to];
        if (!target || target.color !== piece.color) out.push(to);
      }
    }
    return out;
  }

  if (piece.type === "k") {
    for (const step of KING_STEPS) {
      const to = from + step;
      if (stepIsValid(from, to) && Math.max(Math.abs(fileOf(from) - fileOf(to)), Math.abs(rankOf(from) - rankOf(to))) === 1) {
        const target = board[to];
        if (!target || target.color !== piece.color) out.push(to);
      }
    }
    return out;
  }

  if (piece.type === "p") {
    const forward = piece.color === "w" ? -8 : 8;
    const startRank = piece.color === "w" ? 6 : 1;
    const one = from + forward;
    if (one >= 0 && one < 64 && !board[one]) {
      out.push(one);
      const two = one + forward;
      if (rankOf(from) === startRank && !board[two]) out.push(two);
    }
    // Captures are computed from the pawn's own square. Computing them from the forward
    // square and then stepping sideways lands on a square the pawn could not reach, and
    // misses the one beside it.
    for (const side of [-1, 1]) {
      const capture = from + forward + side;
      if (capture < 0 || capture > 63 || Math.abs(fileOf(from) - fileOf(capture)) !== 1) continue;
      const target = board[capture];
      if (target && target.color !== piece.color) out.push(capture);
    }
    return out;
  }

  const dirs = piece.type === "b" ? BISHOP_DIRS : piece.type === "r" ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
  for (const dir of dirs) {
    let current = from;
    for (;;) {
      const next = current + dir;
      if (next < 0 || next > 63) break;
      // A step of 1 or 7 or 9 must not wrap; comparing files catches every case.
      if (Math.abs(fileOf(current) - fileOf(next)) > 1) break;
      current = next;
      if (!add(next)) break;
    }
  }
  return out;
}

/** The square of `color`'s king, or -1 if it is not on the board. */
export function findKing(board: Board, color: Color): number {
  return board.findIndex((piece) => piece !== null && piece.color === color && piece.type === "k");
}

/** Whether `square` is attacked by any piece of `by`. */
export function isAttacked(board: Board, square: number, by: Color): boolean {
  for (let from = 0; from < 64; from += 1) {
    const piece = board[from];
    if (!piece || piece.color !== by) continue;
    if (pseudoMoves(board, from, piece).includes(square)) return true;
  }
  return false;
}

export function inCheck(state: Pick<ChessState, "board">, color: Color): boolean {
  const king = findKing(state.board, color);
  if (king < 0) return false;
  return isAttacked(state.board, king, otherColor(color));
}

function applyRaw(board: Board, from: number, to: number, promotion?: PieceType): Board {
  const next = board.slice();
  const piece = next[from];
  if (!piece) return next;
  next[to] = promotion && piece.type === "p" ? { color: piece.color, type: promotion } : piece;
  next[from] = null;
  return next;
}

/** Legal moves for the piece on `from`, including castling and en passant. */
export function movesFrom(state: ChessState, from: number): ChessMove[] {
  const piece = state.board[from];
  if (!piece || piece.color !== state.turn) return [];
  const out: ChessMove[] = [];
  const promotion: PieceType[] = piece.type === "p" && (rankOf(from) === 1 || rankOf(from) === 6) ? ["q", "r", "b", "n"] : [];

  for (const to of pseudoMoves(state.board, from, piece)) {
    if (leavesKingInCheck(state, from, to, piece)) continue;
    if (promotion.length > 0 && (rankOf(to) === 0 || rankOf(to) === 7)) {
      for (const type of promotion) out.push({ from, to, promotion: type });
    } else {
      out.push({ from, to });
    }
  }

  // En passant: the pawn lands beside the file it would have been on.
  if (piece.type === "p" && state.enPassant !== null) {
    const forward = piece.color === "w" ? -8 : 8;
    const captureSquare = state.enPassant;
    // The capturing pawn stands beside the passed pawn, which is one rank *behind* the square
    // it appears to capture on. Adding instead of subtracting put it on the far side of the
    // board, so the move was never offered at all.
    const besidePawn = captureSquare - forward;
    const onNextFile = Math.abs(fileOf(from) - fileOf(besidePawn)) === 1;
    if (rankOf(from) === rankOf(besidePawn) && onNextFile) {
      if (!leavesKingInCheck(state, from, captureSquare, piece)) out.push({ from, to: captureSquare });
    }
  }

  // Castling, with every condition checked rather than assumed.
  if (piece.type === "k") {
    const colourRights = state.castling[piece.color];
    const homeRank = piece.color === "w" ? 7 : 0;
    if (rankOf(from) === homeRank && fileOf(from) === 4) {
      if (colourRights.k) {
        const rook = state.board[from + 3];
        if (rook && rook.type === "r" && rook.color === piece.color &&
            !state.board[from + 1] && !state.board[from + 2] &&
            !inCheck(state, piece.color) &&
            !isAttacked(state.board, from + 1, otherColor(piece.color)) &&
            !isAttacked(state.board, from + 2, otherColor(piece.color))) {
          out.push({ from, to: from + 2 });
        }
      }
      if (colourRights.q) {
        const rook = state.board[from - 4];
        if (rook && rook.type === "r" && rook.color === piece.color &&
            !state.board[from - 1] && !state.board[from - 2] && !state.board[from - 3] &&
            !inCheck(state, piece.color) &&
            !isAttacked(state.board, from - 1, otherColor(piece.color)) &&
            !isAttacked(state.board, from - 2, otherColor(piece.color))) {
          out.push({ from, to: from - 2 });
        }
      }
    }
  }

  return out;
}

/** Whether playing `from -> to` would leave the mover's own king attacked. */
function leavesKingInCheck(state: ChessState, from: number, to: number, piece: Piece): boolean {
  const board = state.board.slice();
  // En passant removes a pawn on a square the move does not land on.
  const isEnPassant = piece.type === "p" && state.enPassant === to && !state.board[to];
  if (isEnPassant) {
    board[to + (piece.color === "w" ? 8 : -8)] = null;
  }
  board[to] = piece;
  board[from] = null;
  const king = findKing(board, piece.color);
  if (king < 0) return false;
  return isAttacked(board, king, otherColor(piece.color));
}

/** Every legal move for the side to move. */
export function legalMoves(state: ChessState): ChessMove[] {
  const out: ChessMove[] = [];
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (!piece || piece.color !== state.turn) continue;
    for (const move of movesFrom(state, from)) {
      // Castling is emitted as a king move; a sanity check keeps only real ones.
      if (!out.some((existing) => existing.from === move.from && existing.to === move.to && existing.promotion === move.promotion)) {
        out.push(move);
      }
    }
  }
  return out;
}

export function isLegal(state: ChessState, move: ChessMove): boolean {
  return movesFrom(state, move.from).some(
    (candidate) => candidate.to === move.to && candidate.promotion === move.promotion
  );
}

const LETTER: Record<PieceType, string> = { p: "", n: "N", b: "B", r: "R", q: "Q", k: "K" };

/** Algebraic notation, with disambiguation. Good enough to read; used in the move list. */
function toSan(state: ChessState, move: ChessMove, next: ChessState): string {
  const piece = state.board[move.from];
  if (!piece) return "";
  const isCastle = piece.type === "k" && Math.abs(move.to - move.from) === 2;
  if (isCastle) {
    return (move.to > move.from ? "O-O" : "O-O-O") + (inCheck(next, next.turn) ? "+" : "");
  }
  const capture = Boolean(state.board[move.to]) || (piece.type === "p" && state.enPassant === move.to);
  let text = "";
  if (piece.type === "p") {
    if (capture) text += "abcdefgh"[fileOf(move.from)] + "x";
  } else {
    text += LETTER[piece.type];
    const rivals = legalMoves(state).filter(
      (other) => other.to === move.to && other.from !== move.from &&
        state.board[other.from]?.type === piece.type && state.board[other.from]?.color === piece.color
    );
    const sameFile = rivals.some((other) => fileOf(other.from) === fileOf(move.from));
    const sameRank = rivals.some((other) => rankOf(other.from) === rankOf(move.from));
    if (rivals.length > 0) text += sameFile ? String(8 - rankOf(move.from)) : "abcdefgh"[fileOf(move.from)];
    else if (sameRank) text += "abcdefgh"[fileOf(move.from)];
    else if (sameFile) text += String(8 - rankOf(move.from));
    if (capture) text += "x";
  }
  text += squareName(move.to);
  if (move.promotion) text += `=${move.promotion.toUpperCase()}`;
  if (inCheck(next, next.turn)) text += legalMoves(next).length === 0 ? "#" : "+";
  return text;
}

/** Applies a legal move without validation. Only used after `isLegal` said yes. */
function playMove(state: ChessState, move: ChessMove): ChessState {
  const piece = state.board[move.from]!;
  const board = state.board.slice();
  const isEnPassant = piece.type === "p" && state.enPassant === move.to && !state.board[move.to];
  const captured = isEnPassant ? board[move.to + (piece.color === "w" ? 8 : -8)] : board[move.to];

  board[move.to] = move.promotion && piece.type === "p" ? { color: piece.color, type: move.promotion } : piece;
  board[move.from] = null;
  if (isEnPassant) board[move.to + (piece.color === "w" ? 8 : -8)] = null;

  const castling: CastlingRights = {
    w: { ...state.castling.w },
    b: { ...state.castling.b },
  };
  if (piece.type === "k") castling[piece.color] = { k: false, q: false };
  if (piece.type === "r") {
    if (move.from === squareIndex("h1")) castling.w.k = false;
    if (move.from === squareIndex("a1")) castling.w.q = false;
    if (move.from === squareIndex("h8")) castling.b.k = false;
    if (move.from === squareIndex("a8")) castling.b.q = false;
  }
  // A rook taken on its home square removes that right too, or the game later castles with
  // a rook that no longer exists.
  if (move.to === squareIndex("h1")) castling.w.k = false;
  if (move.to === squareIndex("a1")) castling.w.q = false;
  if (move.to === squareIndex("h8")) castling.b.k = false;
  if (move.to === squareIndex("a8")) castling.b.q = false;

  // The rook moves with the king; forgetting this leaves it on its home square.
  if (piece.type === "k" && Math.abs(move.to - move.from) === 2) {
    const rookFrom = move.to > move.from ? move.from + 3 : move.from - 4;
    const rookTo = move.to > move.from ? move.from + 1 : move.from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }

  const next: ChessState = {
    board,
    turn: otherColor(state.turn),
    castling,
    enPassant: null,
    halfmoveClock: piece.type === "p" || captured ? 0 : state.halfmoveClock + 1,
    fullmove: state.turn === "b" ? state.fullmove + 1 : state.fullmove,
    history: state.history.slice(),
    positions: state.positions.slice(),
    result: null,
    endedBy: null,
  };
  if (piece.type === "p" && Math.abs(move.to - move.from) === 16) {
    next.enPassant = (move.from + move.to) / 2;
  }
  next.positions.push(positionKey(next));
  return { ...next, history: [...state.history], result: null, endedBy: null, board: next.board } as ChessState;
}

/**
 * Whether the position is a draw by insufficient material.
 *
 * Deliberately limited to the cases that cannot become a mate: king against king, and king
 * plus one minor piece. Two knights can mate with help, and this does not claim otherwise -
 * the boundary is written down here rather than pretended away.
 */
export function isDeadPosition(board: Board): boolean {
  const pieces: Piece[] = board.filter((piece): piece is Piece => piece !== null);
  if (pieces.some((piece) => piece.type === "p" || piece.type === "r" || piece.type === "q")) return false;
  const minors = pieces.filter((piece) => piece.type === "n" || piece.type === "b");
  if (minors.length >= 2) return false;
  return true;
}

/**
 * Draw by repetition and move count, under the rules this game states.
 *
 * Threefold repetition and the fifty-move rule are claimable; fivefold and seventy-five moves
 * end the game automatically. That distinction is a product decision, so it lives here and
 * not behind whatever `isGameOver()` a library happens to expose.
 */
export function drawByRepetition(state: ChessState): boolean {
  const key = state.positions[state.positions.length - 1];
  const count = state.positions.filter((position) => position === key).length;
  return count >= 5;
}

export function drawByFiftyMoves(state: ChessState): boolean {
  return state.halfmoveClock >= 75;
}

/** Whether the player may claim a draw right now. The interface offers the claim. */
export function canClaimDraw(state: ChessState): boolean {
  const key = state.positions[state.positions.length - 1];
  const count = state.positions.filter((position) => position === key).length;
  return count >= 3 || state.halfmoveClock >= 50 || isDeadPosition(state.board);
}

function finish(state: ChessState, result: GameResult, endedBy: string | null): ChessState {
  return { ...state, result, endedBy };
}

/** Resolves mate, stalemate and the automatic draws after a move. */
function settle(state: ChessState): ChessState {
  const moves = legalMoves(state);
  if (inCheck(state, state.turn)) {
    if (moves.length === 0) {
      // Checkmate: the side that just moved wins. It is the moving side's opponent.
      return finish(state, { kind: "win", winnerId: otherColor(state.turn), reason: "мат" }, "mate");
    }
  } else if (moves.length === 0) {
    return finish(state, { kind: "draw", reason: "пат" }, "stalemate");
  }
  if (isDeadPosition(state.board)) {
    return finish(state, { kind: "draw", reason: "недостаток материала" }, "material");
  }
  if (drawByRepetition(state)) {
    return finish(state, { kind: "draw", reason: "пятикратное повторение" }, "repetition");
  }
  if (drawByFiftyMoves(state)) {
    return finish(state, { kind: "draw", reason: "75 ходов без взятий и движения пешек" }, "fifty-moves");
  }
  return state;
}

export const CHESS_RULES = [
  "Партия заканчивается матом: король под атакой, и от неё нельзя защититься.",
  "Пат — это ничья: ходов нет, но король не под атакой.",
  "Ничья также при недостатке материала, пятикратном повторении позиции и 75 ходах без взятий и ходов пешками.",
  "Заявить ничью по трёхкратному повторению или 50 ходам можно кнопкой «Ничья».",
  "Рокировка не делается, если король под шахом, проходит через атакованное поле или двигались король либо ладья.",
  "Взятие на проходе доступно только сразу после двойного хода пешки.",
];

export function createChess(options: CreateOptions): ChessState {
  void options;
  return initialState();
}

export const chessEngine: GameEngine<ChessState, ChessAction> = {
  kind: "chess",
  rulesVersion: 1,
  rules: CHESS_RULES,
  create: createChess,
  actions(state) {
    if (state.result) return [];
    const out: ChessAction[] = legalMoves(state).map((move) => ({
      type: "move" as const,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
    }));
    out.push({ type: "resign" }, { type: "offer-draw" });
    if (canClaimDraw(state)) out.push({ type: "accept-draw" });
    return out;
  },
  apply(state, action) {
    if (state.result) {
      return { state, changed: false, reason: "Партия уже закончена" };
    }
    if (action.type === "resign") {
      const loser = state.turn;
      return {
        state: finish(state, { kind: "win", winnerId: otherColor(loser), reason: "сдача" }, loser),
        changed: true,
      };
    }
    if (action.type === "offer-draw") {
      // An offer is not a result: it is a request. Accepting is a separate action.
      return { state, changed: false, reason: "Ничья предлагается сопернику, а не себе" };
    }
    if (action.type === "accept-draw") {
      if (!canClaimDraw(state)) {
        return { state, changed: false, reason: "Основания для ничьей пока нет" };
      }
      return { state: finish(state, { kind: "draw", reason: "по заявлению" }, null), changed: true };
    }
    if (!isLegal(state, action)) {
      return { state, changed: false, reason: describeIllegal(state, action) };
    }
    const played = playMove(state, action);
    const san = toSan(state, action, played);
    const piece = state.board[action.from]!;
    const record: MoveRecord = {
      move: { from: action.from, to: action.to, promotion: action.promotion },
      piece,
      captured: state.board[action.to],
      san,
    };
    const withHistory: ChessState = { ...played, history: [...state.history, record] };
    return { state: settle(withHistory), changed: true };
  },
  result(state) {
    return state.result;
  },
  describe(state) {
    if (state.result) return "Партия закончена";
    return state.turn === "w" ? "Ход белых" : "Ход чёрных";
  },
};

/** Explains a refused move in terms the player can use. */
function describeIllegal(state: ChessState, action: ChessMove): string {
  const piece = state.board[action.from];
  if (!piece) return "На этой клетке нет фигуры";
  if (piece.color !== state.turn) return "Сейчас ход другого игрока";
  const legal = movesFrom(state, action.from);
  if (legal.length === 0) return "У этой фигуры нет допустимых ходов";
  if (legal.some((move) => move.to === action.to) && !action.promotion) {
    return "Пешке на последней линии нужно выбрать фигуру для превращения";
  }
  if (leavesKingInCheck(state, action.from, action.to, piece)) {
    return "Этот ход оставляет вашего короля под шахом";
  }
  if (piece.type === "k" && Math.abs(action.to - action.from) === 2) {
    return "Рокировка сейчас невозможна: король под шахом, поле под атакой или фигуры уже двигались";
  }
  return "Так эта фигура не ходит";
}

/** The captured pieces of one colour, for the side panel. */
export function capturedBy(state: ChessState, color: Color): Piece[] {
  return state.history
    .filter((record) => record.piece.color === color && record.captured)
    .map((record) => record.captured!)
    .sort((a, b) => "qrbnp".indexOf(a.type) - "qrbnp".indexOf(b.type));
}

/** Point value of the material on the board, for the bot and the score line. */
export const PIECE_VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function materialBalance(board: Board): number {
  let total = 0;
  for (const piece of board) {
    if (!piece) continue;
    total += piece.color === "w" ? PIECE_VALUE[piece.type] : -PIECE_VALUE[piece.type];
  }
  return total;
}

/** Compact PGN, enough to read a game back and to export it. */
export function toPgn(state: ChessState, whiteName: string, blackName: string): string {
  const lines: string[] = [];
  lines.push('[Event "NEXUS"]');
  lines.push('[Site "NEXUS messenger"]');
  lines.push(`[White "${whiteName}"]`);
  lines.push(`[Black "${blackName}"]`);
  lines.push(`[Result "${pgnResult(state)}"]`);
  lines.push(`[RulesVersion "${chessEngine.rulesVersion}"]`);
  lines.push("");
  const parts: string[] = [];
  for (let i = 0; i < state.history.length; i += 1) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(state.history[i].san);
  }
  parts.push(pgnResult(state));
  lines.push(parts.join(" "));
  return lines.join("\n");
}

function pgnResult(state: ChessState): string {
  if (!state.result) return "*";
  if (state.result.kind === "draw") return "1/2-1/2";
  return state.result.winnerId === "w" ? "1-0" : "0-1";
}

/** A stable colour assignment from the seed, so a rematch can swap fairly. */
export function assignColours(players: Player[], random: () => number): Player[] {
  const isWhite = random() < 0.5;
  return players.map((player, index) => ({
    ...player,
    seat: index === 0 ? (isWhite ? "w" : "b") : isWhite ? "b" : "w",
  }));
}

export function makeChessRandom(seed: number): () => number {
  return makeRandom(seed);
}
