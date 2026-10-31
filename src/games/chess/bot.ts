/**
 * A chess opponent that can only play legal moves.
 *
 * The plan is explicit that this is not a strong engine and must not pretend to be one: there
 * is no rating here, no opening book, and the search is shallow. What it does have to do is
 * play a real game - never an illegal move, never a move that loses material for no reason, and
 * never a move that takes a measurable amount of time on a phone.
 *
 * The search is a plain negamax with alpha-beta pruning. The evaluation counts material and a
 * little king safety, which is enough to punish hanging a queen and not enough to play like a
 * club player. Being honest about that is more useful than a tablebase of lies.
 */

import {
  chessEngine,
  findKing,
  inCheck,
  isAttacked,
  legalMoves,
  otherColor,
  PIECE_VALUE,
  squareName,
  type ChessMove,
  type ChessState,
  type Color,
  type PieceType,
} from "./engine";

export type Difficulty = "easy" | "normal";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Начальный",
  normal: "Обычный",
};

export const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  easy: "Смотрит на один ход вперёд и иногда выбирает не лучшее продолжение.",
  normal: "Смотрит на два-три хода вперёд и оценивает материал и безопасность короля.",
};

/** How long the bot may think. A phone should not wait several seconds for a move. */
export const SEARCH_LIMITS: Record<Difficulty, { depth: number; budgetMs: number }> = {
  easy: { depth: 1, budgetMs: 120 },
  normal: { depth: 3, budgetMs: 900 },
};

function applyMove(state: ChessState, move: ChessMove): ChessState {
  return chessEngine.apply(state, { type: "move", from: move.from, to: move.to, promotion: move.promotion }).state;
}

/**
 * Scores a position from white's point of view.
 *
 * Material dominates, because a shallow search that ignores material plays nonsense. The
 * remaining terms are small on purpose: a large king-safety weight makes a depth-one bot avoid
 * perfectly good moves for reasons a player cannot see.
 */
export function evaluate(state: ChessState): number {
  let score = 0;
  for (let square = 0; square < 64; square += 1) {
    const piece = state.board[square];
    if (!piece) continue;
    const sign = piece.color === "w" ? 1 : -1;
    score += sign * PIECE_VALUE[piece.type];
    // Central pawns and knights are worth slightly more than corner ones.
    const file = square % 8;
    const rank = Math.floor(square / 8);
    const centre = 3.5;
    if (piece.type === "p" || piece.type === "n") {
      score += sign * Math.round(6 * (3.5 - Math.abs(file - centre)) / 3.5);
      score += sign * Math.round(4 * (3.5 - Math.abs(rank - centre)) / 3.5);
    }
  }
  // A king in check is a king in trouble; the size is small because check is not itself a loss.
  for (const colour of ["w", "b"] as Color[]) {
    if (inCheck(state, colour)) score += colour === "w" ? -25 : 25;
  }
  return score;
}

type SearchContext = {
  deadline: number;
  nodes: number;
  /** Set when the budget ran out, so a partial result is not mistaken for a complete one. */
  aborted: boolean;
};

function aborted(context: SearchContext): boolean {
  return context.nodes % 512 === 0 && Date.now() > context.deadline;
}

/**
 * Negamax with alpha-beta pruning.
 *
 * `sign` converts the score to the side-to-move's point of view, which is what makes the same
 * function usable at every depth.
 */
function search(
  state: ChessState,
  depth: number,
  alpha: number,
  beta: number,
  colour: Color,
  context: SearchContext
): number {
  context.nodes += 1;
  if (aborted(context)) {
    context.aborted = true;
    return 0;
  }
  if (state.result) {
    if (state.result.kind === "draw") return 0;
    return state.result.winnerId === colour ? 100000 : -100000;
  }
  const moves = legalMoves(state);
  if (moves.length === 0) {
    // Mate or stalemate. Both are losing or neutral, never winning.
    return inCheck(state, state.turn) ? -90000 : 0;
  }
  if (depth === 0) {
    const score = evaluate(state);
    return colour === "w" ? score : -score;
  }

  // Order by capture value first: alpha-beta prunes far more when the good moves come early.
  const ordered = moves.slice().sort((a, b) => captureScore(state, b) - captureScore(state, a));
  let best = -Infinity;
  for (const move of ordered) {
    const next = applyMove(state, move);
    const score = -search(next, depth - 1, -beta, -alpha, otherColor(colour), context);
    if (context.aborted) return best === -Infinity ? 0 : best;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function captureScore(state: ChessState, move: ChessMove): number {
  const victim = state.board[move.to];
  const attacker = state.board[move.from];
  if (!victim || !attacker) return 0;
  return PIECE_VALUE[victim.type] - PIECE_VALUE[attacker.type] / 10;
}

/**
 * Chooses a move. Always legal, or null when the game is over.
 *
 * The randomness for the easy level comes from `random`, which is passed in rather than read
 * from the global: a bot that cannot be made deterministic cannot be tested, and a test that
 * cannot reproduce a bad move cannot explain it.
 */
export function chooseMove(
  state: ChessState,
  difficulty: Difficulty,
  random: () => number = Math.random,
  limits = SEARCH_LIMITS[difficulty]
): ChessMove | null {
  // A finished game has no turn to take. Without this the bot happily suggests a move for
  // the loser of a game that is already over, and the interface offers it.
  if (state.result) return null;
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const colour = state.turn;
  const context: SearchContext = {
    deadline: Date.now() + limits.budgetMs,
    nodes: 0,
    aborted: false,
  };

  const scored = moves.map((move) => {
    const next = applyMove(state, move);
    const score = -search(next, limits.depth - 1, -Infinity, Infinity, otherColor(colour), context);
    return { move, score: context.aborted ? 0 : score };
  });

  const best = Math.max(...scored.map((entry) => entry.score));
  // A small window around the best score lets the easy level look human without ever playing
  // a move that is plainly bad. A random move from the whole list would hang a queen.
  const window = difficulty === "easy" ? 60 : 0;
  const candidates = scored.filter((entry) => entry.score >= best - window);
  const pick = candidates[Math.floor(random() * candidates.length)] ?? scored[0];
  return pick.move;
}

/** For the interface: which side the bot plays, if any. */
export function botColour(players: { id: string; seat: string; bot: boolean }[], humanId: string): Color | null {
  const bot = players.find((player) => player.bot && player.id !== humanId);
  return bot ? (bot.seat as Color) : null;
}

/** A readable description of what the bot did, for the move list and the tests. */
export function describeBotMove(state: ChessState, move: ChessMove): string {
  const piece: PieceType | undefined = state.board[move.from]?.type;
  const name = piece ? { p: "пешка", n: "конь", b: "слон", r: "ладья", q: "ферзь", k: "король" }[piece] : "фигура";
  return `${name} ${squareName(move.from)} → ${squareName(move.to)}`;
}

/** Whether the side to move is in mate, used to stop a game the interface forgot to stop. */
export function isMated(state: ChessState): boolean {
  return inCheck(state, state.turn) && legalMoves(state).length === 0;
}

export { findKing, isAttacked };
