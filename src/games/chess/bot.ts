/**
 * The chess opponent.
 *
 * The plan is explicit that this is not a strong engine and must not pretend to be one: there is
 * no rating here, no opening book and no tablebase. What it has to do is play a real game - only
 * legal moves, a move that does not hang a queen for nothing, a mate taken when one is on the
 * board - and stop the moment it is told to.
 *
 * Two things shape the code:
 *
 * - **It runs in a Web Worker.** The module therefore imports only the engine and pure helpers.
 *   No `window`, no `document`, no `localStorage`: a search that touched the DOM would fail in
 *   the worker exactly when a phone needed it most.
 * - **It must be cancellable.** A player who starts a new game or closes the screen must not wait
 *   for an old search. Cancellation is checked inside the search loop, and every depth's partial
 *   result is kept, so a cancelled search still answers with the best move it had - never with a
 *   random one.
 *
 * The search is negamax with alpha-beta pruning, an iterative deepening loop, move ordering by
 * captures and promotions, and a small quiescence pass so the engine does not stop counting in
 * the middle of an exchange. The evaluation counts material, piece-square placement and a little
 * king safety. Being honest about the ceiling is more useful than a rating of lies.
 */

import { Chess } from "chess.js";
import type { PieceSymbol, Square } from "chess.js";
import { PIECE_VALUE } from "./session";

export type Difficulty = "easy" | "normal";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Начальный",
  normal: "Обычный",
};

export const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  easy: "Смотрит на два хода и иногда выбирает не лучшее продолжение.",
  normal: "Смотрит на три-четыре хода и считает материал, развитие и безопасность короля.",
};

/**
 * How long the bot may think.
 *
 * The budget is a ceiling, not a plan: iterative deepening stops when the time runs out, and a
 * phone that takes four hundred milliseconds to reach depth three gets a depth-four answer only
 * if that takes less than the budget. A player should never wait three seconds for a move.
 */
export const SEARCH_LIMITS: Record<Difficulty, { depth: number; budgetMs: number; quiescence: number }> = {
  easy: { depth: 2, budgetMs: 150, quiescence: 0 },
  normal: { depth: 4, budgetMs: 700, quiescence: 3 },
};

export type BotMove = { from: Square; to: Square; promotion?: PieceSymbol };

/** A request from the screen or the worker's message handler. */
export type BotRequest = {
  /** The position to move in, as a FEN. The bot never sees the saved game, only the position. */
  fen: string;
  difficulty: Difficulty;
  /** A cancellation token the caller flips; checked many times a second. */
  isCancelled?: () => boolean;
  /** The clock, injectable so a test can run a deterministic search. */
  now?: () => number;
  /** Randomness for the easy level's deliberately imperfect choice; injectable for tests. */
  random?: () => number;
  /** Overrides for the tests: a tiny budget or depth keeps a suite fast. */
  limits?: { depth: number; budgetMs: number; quiescence: number };
};

export type BotAnswer = {
  /** The chosen move, or null when the position has no legal move. */
  move: BotMove | null;
  /** The engine's score in centipawns from the mover's point of view, for logs and tests. */
  score: number;
  depth: number;
  nodes: number;
  /** True when the search stopped because the budget or the caller stopped it. */
  stopped: boolean;
  /** Why no move was produced, when that is the case. */
  reason?: string;
};

/**
 * Piece-square tables, used as a bonus on top of material.
 *
 * The tables are the classic "simplified evaluation" ones: they make a knight prefer the centre
 * and a king prefer the corner until the endgame, which is enough for a depth-three search to
 * look like chess rather than noise. Row 0 is the eighth rank, as chess.js reports squares.
 */
const PAWN_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const KNIGHT_TABLE = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const BISHOP_TABLE = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
const ROOK_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const QUEEN_TABLE = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const KING_MIDDLE = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];

const TABLES: Record<PieceSymbol, number[]> = {
  p: PAWN_TABLE,
  n: KNIGHT_TABLE,
  b: BISHOP_TABLE,
  r: ROOK_TABLE,
  q: QUEEN_TABLE,
  k: KING_MIDDLE,
};

const MATE = 100000;
/** Scores within this of mate are mate scores, not material scores. */
const MATE_BOUND = MATE - 1000;

/**
 * Evaluates a position from white's side, in centipawns.
 *
 * Exported because it is the part worth testing on its own: a bot whose evaluation prefers a lost
 * queen cannot be fixed by deeper search.
 */
export function evaluate(chess: Chess): number {
  let score = 0;
  let bishops = { w: 0, b: 0 };
  let majors = 0;
  const kings: { color: "w" | "b"; file: number; row: number }[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      const file = cell.square.charCodeAt(0) - 97;
      // chess.js reports rank as a digit from 1 to 8; the tables are indexed from a8 down.
      const rowIndex = 8 - Number(cell.square[1]);
      const sign = cell.color === "w" ? 1 : -1;
      // The tables are written from white's side: the bonus for "the seventh rank" sits at row 1.
      // Black must read the same table upside down and from the other file, or a mirrored position
      // does not score as its own negative - and the engine starts preferring moves that help the
      // opponent.
      const tableIndex = cell.color === "w" ? rowIndex * 8 + file : (7 - rowIndex) * 8 + (7 - file);
      score += sign * (PIECE_VALUE[cell.type] + TABLES[cell.type][tableIndex]);
      if (cell.type === "b") bishops[cell.color] += 1;
      if (cell.type === "k") kings.push({ color: cell.color, file, row: rowIndex });
      if (cell.type !== "p" && cell.type !== "k") majors += 1;
    }
  }
  // A pair of bishops is worth about half a pawn: together they cover both colours for good.
  if (bishops.w >= 2) score += 30;
  if (bishops.b >= 2) score -= 30;
  // In an endgame the king wants the middle; the middle-game table already punishes it there. The
  // bonus uses board rows, not chess.js ranks: mixing the two mirrors one side and turns a drawn
  // start into a three-pawn score for black.
  if (majors <= 4) {
    for (const king of kings) {
      const central = 14 - Math.round((Math.abs(king.file - 3.5) + Math.abs(king.row - 3.5)) * 4);
      score += (king.color === "w" ? 1 : -1) * central;
    }
  }
  return score;
}

/** Move ordering: captures first, ordered by what is taken over what is risked, then promotions. */
function orderScore(move: { captured?: PieceSymbol; promotion?: PieceSymbol; piece: PieceSymbol }): number {
  let score = 0;
  if (move.captured) score += 1000 + PIECE_VALUE[move.captured] * 10 - PIECE_VALUE[move.piece];
  if (move.promotion) score += 800 + PIECE_VALUE[move.promotion];
  return score;
}

type Context = {
  nodes: number;
  deadline: number;
  now: () => number;
  isCancelled: () => boolean;
  stopped: boolean;
  quiescence: number;
};

function shouldStop(context: Context): boolean {
  if (context.stopped) return true;
  // Checking the clock on every node costs more than the work it guards; every 1024 nodes is
  // frequent enough that a cancelled search ends well inside a frame.
  if ((context.nodes & 1023) === 0 && context.now() > context.deadline) {
    context.stopped = true;
    return true;
  }
  if ((context.nodes & 63) === 0 && context.isCancelled()) {
    context.stopped = true;
  }
  return context.stopped;
}

/**
 * The moves of a position as plain SAN strings, for the inner search.
 *
 * chess.js's verbose move list builds a notation string for every move, and that costs thirteen
 * times what a plain list does - measured, not guessed. The inner search only needs to replay
 * moves, so it uses the cheap form; only the root, which has to report the choice and its value,
 * pays for the verbose list.
 */
function plainMoves(chess: Chess): string[] {
  return chess.moves();
}

/** Whether the move that was just replayed undoes an earlier capture. */
function isCapture(move: string): boolean {
  return move.includes("x");
}

/**
 * Quiescence: keep searching captures until the position is quiet.
 *
 * Without it the engine evaluates in the middle of an exchange and hangs pieces it thought were
 * defended. The depth cap keeps a long sequence of captures from exploding.
 */
function quiesce(chess: Chess, alpha: number, beta: number, context: Context, depth: number): number {
  context.nodes += 1;
  if (shouldStop(context)) return 0;
  const side = chess.turn() === "w" ? 1 : -1;
  const standPat = side * evaluate(chess);
  if (depth === 0) return standPat;
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  // Only captures; a promotion is worth seeing too, and SAN spells it with "=".
  const moves = plainMoves(chess).filter((move) => isCapture(move) || move.includes("="));
  for (const move of moves) {
    chess.move(move);
    const score = -quiesce(chess, -beta, -alpha, context, depth - 1);
    chess.undo();
    if (context.stopped) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Negamax with alpha-beta pruning. Returns the score from the side to move's point of view. */
function search(chess: Chess, depth: number, alpha: number, beta: number, context: Context): number {
  context.nodes += 1;
  if (shouldStop(context)) return 0;
  if (depth === 0) {
    if (context.quiescence > 0) return quiesce(chess, alpha, beta, context, context.quiescence);
    return (chess.turn() === "w" ? 1 : -1) * evaluate(chess);
  }
  const moves = plainMoves(chess);
  if (moves.length === 0) {
    // Mate and stalemate. A mate in fewer moves is worse than one in more, so the remaining depth
    // is part of the score; without it the engine shuffles when it could mate now.
    if (chess.isCheck()) return -MATE + (10 - depth);
    return 0;
  }
  // Captures first: good ordering is what makes alpha-beta cut off early.
  moves.sort((a, b) => Number(isCapture(b) || b.includes("=")) - Number(isCapture(a) || a.includes("=")));
  let best = -Infinity;
  for (const move of moves) {
    chess.move(move);
    const score = -search(chess, depth - 1, -beta, -alpha, context);
    chess.undo();
    if (context.stopped) return best === -Infinity ? 0 : best;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Chooses a move.
 *
 * Iterative deepening is used for one reason a plain depth search cannot give: a cancelled search
 * still has an answer from the last completed depth, so a closed screen or a new game never
 * throws away the thinking that already happened. The easy level then picks among moves that are
 * close to the best instead of the best, which makes it beatable without ever playing a random
 * move - a random move would hang a queen and teach a new player nothing.
 */
export function chooseMove(request: BotRequest): BotAnswer {
  const now = request.now ?? (() => Date.now());
  const random = request.random ?? Math.random;
  const isCancelled = request.isCancelled ?? (() => false);
  const limits = request.limits ?? SEARCH_LIMITS[request.difficulty];
  const chess = new Chess(request.fen);
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    return {
      move: null,
      score: 0,
      depth: 0,
      nodes: 0,
      stopped: false,
      reason: chess.isCheck() ? "Партия закончена матом" : "Партия закончена патом",
    };
  }
  if (moves.length === 1) {
    const only = moves[0];
    return {
      move: { from: only.from, to: only.to, promotion: only.promotion },
      score: 0,
      depth: 1,
      nodes: 0,
      stopped: false,
    };
  }

  const context: Context = {
    nodes: 0,
    deadline: now() + limits.budgetMs,
    now,
    isCancelled,
    stopped: false,
    quiescence: limits.quiescence,
  };

  const ordered = moves.slice().sort((a, b) => orderScore(b) - orderScore(a));
  let bestMove: BotMove = { from: ordered[0].from, to: ordered[0].to, promotion: ordered[0].promotion };
  let bestScore = 0;
  let completedDepth = 0;
  /** Every root move with the score from the last completed depth, for the easy level's choice. */
  let rootScores: { move: BotMove; score: number }[] = ordered.map((move) => ({
    move: { from: move.from, to: move.to, promotion: move.promotion },
    score: 0,
  }));

  for (let depth = 1; depth <= limits.depth; depth += 1) {
    const scored: { move: BotMove; score: number }[] = [];
    let alpha = -Infinity;
    for (const move of ordered) {
      chess.move({ from: move.from, to: move.to, promotion: move.promotion });
      const score = -search(chess, depth - 1, -Infinity, -alpha, context);
      chess.undo();
      if (context.stopped) break;
      scored.push({ move: { from: move.from, to: move.to, promotion: move.promotion }, score });
      if (score > alpha) alpha = score;
    }
    if (context.stopped) {
      // A partial depth still improves on the previous one when it has scored the first move.
      if (scored.length > 0) {
        scored.sort((a, b) => b.score - a.score);
        bestMove = scored[0].move;
        bestScore = scored[0].score;
        rootScores = scored;
        completedDepth = Math.max(completedDepth, depth - 1);
      }
      break;
    }
    scored.sort((a, b) => b.score - a.score);
    rootScores = scored;
    bestMove = scored[0].move;
    bestScore = scored[0].score;
    completedDepth = depth;
    // A forced mate is not going to be improved on.
    if (bestScore >= MATE_BOUND) break;
    if (now() > context.deadline) {
      context.stopped = true;
      break;
    }
  }

  if (request.difficulty === "easy" && completedDepth > 0) {
    // Within a pawn and a bit of the best: beatable, still never a hanging piece.
    const window = 120;
    const best = rootScores[0].score;
    const candidates = rootScores.filter((entry) => entry.score >= best - window);
    const pick = candidates[Math.floor(random() * candidates.length)] ?? rootScores[0];
    return { move: pick.move, score: pick.score, depth: completedDepth, nodes: context.nodes, stopped: context.stopped };
  }

  return { move: bestMove, score: bestScore, depth: completedDepth, nodes: context.nodes, stopped: context.stopped };
}

/** Whether the bot's answer is a legal move in the requested position. The screen re-checks. */
export function isAnswerLegal(fen: string, answer: BotAnswer): boolean {
  if (!answer.move) return false;
  const chess = new Chess(fen);
  try {
    chess.move({ from: answer.move.from, to: answer.move.to, promotion: answer.move.promotion });
    return true;
  } catch {
    return false;
  }
}
