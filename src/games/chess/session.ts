/**
 * A chess game, rather than a chess position.
 *
 * The rules themselves are not in this file and must not be: `chess.js` owns legality, castling,
 * en passant, promotion, check and the three basic ways a game stops. Repeating those rules here
 * would create the one bug this rewrite exists to remove - two answers to "is this legal", and a
 * player told "no" by the screen after the engine said "yes".
 *
 * What this file owns is everything a library cannot decide for a product:
 *
 * - **Which draw rule ends the game and which one a player must claim.** Threefold repetition and
 *   the fifty-move rule are claims; fivefold repetition and seventy-five moves end the game on
 *   their own. chess.js exposes `isThreefoldRepetition()` and `isDraw()`, and `isDraw()` is the
 *   union of several rules with one name - using it as the product answer would declare a draw
 *   where a player was entitled to keep playing. The counters below are counted from the stored
 *   history, so the distinction is visible and testable, and `isGameOver()` is never consulted.
 * - **A draw offer, which is a request and not a result.** Resigning, accepting an offer and
 *   claiming a draw are three different actions because they mean three different things to the
 *   person on the other side of the board.
 * - **A state that survives a reload.** The saved value is the starting FEN, every move and the
 *   counters needed to count repetition after the application was closed. A single FEN is not
 *   enough: upon reload it would restart the repetition history, so a player could walk into a
 *   position for the fourth time and be told it is the first.
 *
 * The module never touches `window`, `localStorage` or the DOM. The bot search imports it, and
 * the search runs inside a Web Worker where none of those exist.
 */

import { Chess } from "chess.js";
import type { PieceSymbol, Square } from "chess.js";
import type { ApplyResult, GameResult, PlayMode } from "../core/types";

/** A square is written the way a player reads it: "e4", not an index. */
export type ChessSquare = Square;
export type ChessPieceType = PieceSymbol;
export type Color = "w" | "b";

export type ChessPiece = { type: ChessPieceType; color: Color };

/** One played move, kept so the game can be replayed, exported and counted. */
export type ChessMoveRecord = {
  /** How many moves had been played before this one. The move list's own numbering. */
  ply: number;
  from: ChessSquare;
  to: ChessSquare;
  piece: ChessPieceType;
  color: Color;
  captured: ChessPieceType | null;
  promotion: ChessPieceType | null;
  /** Algebraic notation as chess.js writes it: "Nxe5", "O-O", "exd8=Q+". */
  san: string;
  /** The position after the move, for a viewer stepping through the game. */
  fen: string;
  flags: {
    capture: boolean;
    enPassant: boolean;
    castle: boolean;
    bigPawn: boolean;
    promotion: boolean;
  };
};

/**
 * Why the game ended, in terms of the rule that ended it.
 *
 * `endedBy` is not shown to players - the result line written from it is - but it is what keeps
 * the interface honest: "победа по мату" and "победа по сдаче" are told apart, and so are a draw
 * by agreement and a draw the rules imposed.
 */
export type ChessEnd =
  /** The rules ended it: mate, stalemate, insufficient material or an automatic counter. */
  | { type: "play" }
  | { type: "resign"; by: Color }
  /** A player pressed «Заявить ничью» and the position did allow it. */
  | { type: "claim"; by: Color }
  /** Both sides agreed: an offer was offered and accepted. */
  | { type: "agreement" };

export type ChessSession = {
  /** The rule set this game is played under; saved with it and never reinterpreted. */
  rulesVersion: number;
  /** Position and history in one string; chess.js validates this when a game is reloaded. */
  startFen: string;
  /** Every move, oldest first. A scoresheet is a document, not a cache. */
  moves: ChessMoveRecord[];
  /**
   * The position key after the start position and after every move, exactly as chess.js hashes
   * it: pieces, side to move, castling rights and en passant, with move counters left out. Two
   * positions with the same key are the same position for the repetition rules.
   */
  positionKeys: string[];
  /** Half-moves without a capture or a pawn move; the fifty- and seventy-five-move counters. */
  halfmoveClock: number;
  fullmoveNumber: number;
  /** A draw offer waiting on the opponent. At most one at a time. */
  drawOffer: Color | null;
  /** Set once the game is over. Every command after it is refused. */
  endedBy: ChessEnd;
  result: GameResult | null;
  /** The colour a bot owns in bot mode; null in every other mode. A human never plays it. */
  botColor: Color | null;
  /** How hard the bot thinks. Kept in the game rather than in the screen, so it survives reload. */
  difficulty: "easy" | "normal";
  /** Which colour the person at the screen has in bot mode, and "both" when two people share it. */
  players: { white: string; black: string };
  startedAt: number;
};

export const CHESS_RULES_VERSION = 3;
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * The draw rules, written as the game applies them.
 *
 * The split is the product decision the plan asks for: threefold and fifty moves are claimed by a
 * player who knows they exist, fivefold and seventy-five are automatic. A player who never
 * presses the claim button still gets the automatic draw; nobody else decides for them.
 *
 * **The counting unit is the half-move, and the FIDE numbers are not.**
 *
 * The Laws of Chess count these in *moves*, meaning one move by each player — and one move by each
 * player is two half-moves in a halfmove clock. Article 9.3.2 says "the last 50 moves by each player
 * have been completed without the movement of any pawn and without any capture"; Article 9.6.2 says
 * "any series of at least 75 moves have been made by each player". Since a halfmove clock advances
 * once per ply, the thresholds expressed in half-moves are 100 and 150.
 *
 * This was wrong before: the constants were 50 and 75, so the game offered a fifty-move draw claim
 * after 25 moves each and declared an automatic draw after 37.5 moves each — both at half the
 * distance the Laws allow. The test that pinned it to `halfmoveClock === DRAW_RULES.halfmoveClaim`
 * was itself testing the code against itself rather than against the rule, which is why it agreed.
 * Source: FIDE Laws of Chess, in force from 1 January 2023, Articles 9.3.2 and 9.6.2
 * (https://handbook.fide.com/chapter/E012023).
 *
 * Note that 9.6.2 adds "If the last move resulted in checkmate, that shall take precedence" — a
 * checkmate on the very move that would otherwise hit 150 wins instead of drawing. `applyMove`
 * resolves checkmate before it looks at this threshold, which is what makes that ordering correct.
 */
export const DRAW_RULES = {
  /** Claimable: the same position has now appeared this many times. */
  repetitionClaim: 3,
  /** Claimable: this many half-moves (50 moves each) without a capture or a pawn move. */
  halfmoveClaim: 100,
  /** Automatic: the position has appeared this many times. */
  repetitionAutomatic: 5,
  /** Automatic: this many half-moves (75 moves each) without a capture or a pawn move. */
  halfmoveAutomatic: 150,
} as const;

/**
 * The rules shown to a player before they start.
 *
 * Not a decoration: these lines are the agreement, and the engine below is written to match them.
 * Where this game is narrower than the FIDE Laws, a line says so instead of promising a
 * tournament-certified arbiters' answer. One narrowing is known and stated: dead positions other
 * than "no mating material". Castling is *not* narrowed — see the note on the castling line.
 */
export const CHESS_RULES: string[] = [
  "Обычные шахматы на доске 8×8: все фигуры ходят и берут по своим правилам, своего короля нельзя оставить под шахом.",
  // FIDE 3.8.2.2 item 3 prevents castling when the square the king stands on, crosses, *or is to
  // occupy* is attacked. Refusing to castle into check is therefore the Law, not a deviation from
  // it: the king may not finish the move in check under 3.9.2 in any case.
  "Рокировка в обе стороны разрешена, если король и ладья не двигались, поля между ними пусты, а король не стоит под шахом, не проходит через атакованное поле и не встаёт на атакованное поле.",
  "Взятие на проходе доступно только ходом сразу после двойного хода пешки.",
  "Пешка на последней линии превращается в ферзя, ладью, слона или коня — фигуру выбирает игрок.",
  "Мат — победа, пат — ничья. Победа засчитывается также при сдаче соперника.",
  // 50 moves by each player is 100 half-moves; 75 each is 150. Both are stated as moves each so the
  // text matches the Laws rather than the internal counter.
  "Ничья по трём повторениям позиции или по 50 ходам каждого игрока без взятий и ходов пешками объявляется кнопкой «Заявить ничью». Её может заявить любой игрок, чей ход или который только что ходил.",
  "Пять повторений или 75 ходов каждого игрока без взятий и ходов пешками заканчивают партию ничьей автоматически. Мат последним ходом важнее этой ничьей.",
  "Если ни у одного игрока не осталось материала для мата (одинокие короли; король и слон; король и конь; король против короля со слоном или конём, когда у слабейшего нет того же цвета слонов), партия сразу ничейная.",
  "Ничью можно предложить кнопкой «Ничья»; партия закончится ничьей, только если её примет соперник.",
  "Граница этой версии: другие непробиваемые позиции (например, два коня против коня без пешек) движком не оцениваются, поэтому, если таймер её не закончит, до 75 ходов каждого партия формально продолжается.",
];

/** The modes this game can hold locally. «С другом» needs the server room and is not offered. */
export const AVAILABLE_MODES: PlayMode[] = ["bot", "local"];

/** A short, readable name for a colour, used wherever a player sees whose turn it is. */
export function colorName(color: Color): string {
  return color === "w" ? "белые" : "чёрные";
}

/**
 * The colour in the genitive, for «ход белых».
 *
 * Russian cannot be assembled by gluing a nominative onto a preposition: «Ход белые» is the sort of
 * thing that makes a game look machine-made, and it is the first sentence a player reads.
 */
export function colorGenitive(color: Color): string {
  return color === "w" ? "белых" : "чёрных";
}

export function otherColor(color: Color): Color {
  return color === "w" ? "b" : "w";
}

/**
 * Builds one game. `now` is a parameter rather than `Date.now()` so a test can pin it, and so the
 * worker that imports this file needs no clock.
 */
export function createChessSession(
  options: {
    mode: PlayMode;
    /** Which colour the bot plays. Ignored unless the mode is "bot". */
    botColor?: Color;
    difficulty?: "easy" | "normal";
    startFen?: string;
    players?: { white: string; black: string };
    now?: number;
  }
): ChessSession {
  /*
   * Every play mode is kept as given, not collapsed to two.
   *
   * This used to read `options.mode === "local" ? "local" : "bot"`, which silently turned "friend"
   * into "bot". A networked game created that way would have claimed a bot owned one colour, and
   * the screen uses that to decide which seat is the player's - so both players would have been
   * told they were playing the bot's side. "friend" is a real mode now that games are shared, and
   * the only thing it changes here is that neither colour belongs to a bot.
   */
  const mode: PlayMode = options.mode;
  const startFen = options.startFen && validateStartFen(options.startFen) ? options.startFen : START_FEN;
  const probe = new Chess(startFen);
  const botColor = mode === "bot" ? options.botColor ?? "b" : null;
  const session: ChessSession = {
    rulesVersion: CHESS_RULES_VERSION,
    startFen,
    moves: [],
    positionKeys: [probe.hash()],
    halfmoveClock: clockFrom(startFen, 4),
    fullmoveNumber: clockFrom(startFen, 5),
    drawOffer: null,
    endedBy: { type: "play" },
    result: null,
    botColor,
    difficulty: options.difficulty === "easy" ? "easy" : "normal",
    /*
     * Seat names.
     *
     * `options.players` used to be accepted and then ignored - it is declared in the options type,
     * passed by the games screen, and never read, so a caller that named the seats was silently
     * overruled. For a networked game that matters: the opponent's name comes from the invitation
     * and has to survive into the record, or a reloaded game shows "Чёрные" instead of who is
     * actually sitting there.
     *
     * In bot mode the bot's seat is still named after the bot, because that is the one name the
     * caller cannot supply correctly.
     */
    players:
      mode === "bot"
        ? { white: botColor === "w" ? "Бот" : "Вы", black: botColor === "b" ? "Бот" : "Вы" }
        : options.players ?? { white: "Белые", black: "Чёрные" },
    startedAt: options.now ?? 0,
  };
  return session;
}

export function validateStartFen(fen: string): boolean {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

function clockFrom(fen: string, index: number): number {
  const value = Number(fen.split(" ")[index]);
  return Number.isFinite(value) ? value : index === 4 ? 0 : 1;
}

/**
 * A chess.js instance rebuilt from the session.
 *
 * This is the only place a game's position is reconstructed, and both the move application and
 * the search use it. Rebuilding from `startFen` and the move list - rather than trusting a stored
 * FEN - means a save that lost a field is caught by chess.js rather than played from a position
 * that never existed. chess.js stops counting repetition while its own history is replayed, and
 * the counts this game relies on are kept in `positionKeys`, so no library quirk is involved.
 */
export function toChess(session: ChessSession): Chess {
  const chess = new Chess(session.startFen);
  for (const move of session.moves) {
    try {
      chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined });
    } catch {
      // A stored game that cannot be replayed is corrupt. Returning what could be replayed is
      // the honest answer; `isSessionSound` is what the storage layer asks before loading it.
      break;
    }
  }
  return chess;
}

/** Whether every stored move replays. Used before a saved game is handed to the screen. */
export function isSessionSound(session: ChessSession): boolean {
  if (!validateStartFen(session.startFen)) return false;
  const chess = new Chess(session.startFen);
  for (const move of session.moves) {
    try {
      chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined });
    } catch {
      return false;
    }
  }
  return (
    chess.history().length === session.moves.length &&
    session.positionKeys.length === session.moves.length + 1
  );
}

export function turnOf(session: ChessSession): Color {
  return toChess(session).turn();
}

export function fenOf(session: ChessSession): string {
  return toChess(session).fen();
}

/** A position, for a list of legal moves and for the board. */
export type ChessPositionView = {
  fen: string;
  turn: Color;
  /** The board as chess.js reports it: row 0 is the eighth rank. */
  board: ({ square: ChessSquare; type: ChessPieceType; color: Color } | null)[][];
  moves: {
    from: ChessSquare;
    to: ChessSquare;
    promotion?: ChessPieceType;
    capture: boolean;
  }[];
  check: boolean;
  checkSquare: ChessSquare | null;
  /** The colour of the king in check, or null. */
  checkedColor: Color | null;
};

/** Everything the screen needs to draw one position, computed once. */
export function viewPosition(session: ChessSession): ChessPositionView {
  const chess = toChess(session);
  const moves = chess.moves({ verbose: true });
  const check = chess.isCheck();
  const checkedColor = check ? chess.turn() : null;
  let checkSquare: ChessSquare | null = null;
  if (checkedColor) {
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === "k" && cell.color === checkedColor) checkSquare = cell.square;
      }
    }
  }
  return {
    fen: chess.fen(),
    turn: chess.turn(),
    board: chess.board(),
    moves: moves.map((move) => ({
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      capture: move.isCapture(),
    })),
    check,
    checkSquare,
    checkedColor,
  };
}

export type ChessCommand =
  | { type: "move"; from: ChessSquare; to: ChessSquare; promotion?: ChessPieceType }
  | { type: "resign"; by: Color }
  | { type: "offer-draw"; by: Color }
  | { type: "accept-draw"; by: Color }
  | { type: "claim-draw"; by: Color };

export type ChessOutcome = ApplyResult<ChessSession> & {
  /** The move that was played, when the command was a move. */
  move?: ChessMoveRecord;
};

/**
 * Applies one command.
 *
 * The returned session is the *same object* when the command was refused. Not an equal copy: the
 * screen keys some of its work off identity, and "nothing changed" has to be answerable without
 * comparing a sixty-four-element board.
 */
export function applyChessCommand(session: ChessSession, command: ChessCommand): ChessOutcome {
  if (session.result) {
    return { state: session, changed: false, reason: "Партия уже закончена. Начните новую." };
  }

  switch (command.type) {
    case "move":
      return applyMove(session, command);
    case "resign": {
      if (!isHuman(session, command.by)) {
        return { state: session, changed: false, reason: "Бот не сдаётся" };
      }
      return {
        state: {
          ...session,
          endedBy: { type: "resign", by: command.by },
          result: { kind: "win", winnerId: otherColor(command.by), reason: "соперник сдался" },
        },
        changed: true,
      };
    }
    case "offer-draw": {
      if (!isHuman(session, command.by)) {
        return { state: session, changed: false, reason: "Бот не предлагает ничью" };
      }
      if (session.drawOffer === command.by) {
        return { state: session, changed: false, reason: "Предложение ничьей уже сделано" };
      }
      return { state: { ...session, drawOffer: command.by }, changed: true };
    }
    case "accept-draw": {
      if (session.drawOffer === null) {
        return { state: session, changed: false, reason: "Ничью никто не предлагал" };
      }
      if (session.drawOffer === command.by) {
        return { state: session, changed: false, reason: "Вы предложили ничью, её принимает соперник" };
      }
      return {
        state: { ...session, endedBy: { type: "agreement" }, result: { kind: "draw", reason: "по соглашению сторон" } },
        changed: true,
      };
    }
    case "claim-draw": {
      const claim = drawClaimAvailable(session, command.by);
      if (!claim.allowed) {
        return { state: session, changed: false, reason: claim.reason ?? "Основания для ничьей нет" };
      }
      return {
        state: {
          ...session,
          endedBy: { type: "claim", by: command.by },
          result: { kind: "draw", reason: CLAIM_TEXT[claim.basis as ClaimBasis] },
        },
        changed: true,
      };
    }
    default:
      return { state: session, changed: false, reason: "Неизвестное действие" };
  }
}

export type ClaimBasis = "repetition" | "halfmove" | "material";

/** The wording of each claim, kept next to the rule that produces it so the two cannot drift. */
export const CLAIM_TEXT: Record<ClaimBasis, string> = {
  repetition: "три повторения позиции",
  halfmove: `${DRAW_RULES.halfmoveClaim / 2} ходов каждого без взятий и ходов пешками`,
  material: "недостаток материала для мата",
};

/** Whether `by` may claim a draw right now, and on what basis. */
export function drawClaimAvailable(
  session: ChessSession,
  by: Color
): { allowed: boolean; basis: ClaimBasis | null; reason?: string } {
  if (session.result) return { allowed: false, basis: null, reason: "Партия уже закончена" };
  const chess = toChess(session);
  // FIDE 9.2 and 9.3: the player who has the move, or the player who has just moved, may claim.
  // In this game only bots and humans sit at it, and the colour check keeps a command for the
  // wrong side from ending a game.
  if (by !== "w" && by !== "b") {
    return { allowed: false, basis: null, reason: "Заявить ничью может только участник партии" };
  }
  if (repetitionCount(session) >= DRAW_RULES.repetitionClaim) return { allowed: true, basis: "repetition" };
  if (session.halfmoveClock >= DRAW_RULES.halfmoveClaim) return { allowed: true, basis: "halfmove" };
  if (chess.isInsufficientMaterial()) return { allowed: true, basis: "material" };
  return {
    allowed: false,
    basis: null,
    reason: `Заявить ничью можно при ${DRAW_RULES.repetitionClaim} повторениях позиции или ${DRAW_RULES.halfmoveClaim / 2} ходах каждого без взятий; сейчас ${repetitionCount(session)} повторение и ${Math.floor(session.halfmoveClock / 2)} ходов каждого`,
  };
}

/** How many times the current position has appeared, counted from the saved history. */
export function repetitionCount(session: ChessSession): number {
  if (session.positionKeys.length === 0) return 1;
  const key = session.positionKeys[session.positionKeys.length - 1];
  return session.positionKeys.filter((candidate) => candidate === key).length;
}

function isHuman(session: ChessSession, color: Color): boolean {
  return session.botColor === null || session.botColor !== color;
}

/** Whether the command should be sent by the person moving on the screen, for this colour. */
export function colorIsPlayable(session: ChessSession, color: Color): boolean {
  return isHuman(session, color);
}

function applyMove(
  session: ChessSession,
  command: { from: ChessSquare; to: ChessSquare; promotion?: ChessPieceType }
): ChessOutcome {
  const chess = toChess(session);
  const turn = chess.turn();

  // Say why, in terms a player can use, before letting the library answer "invalid move".
  const fromLegal = chess.moves({ square: command.from, verbose: true });
  if (fromLegal.length === 0) {
    const cell = chess.get(command.from);
    if (!cell) return { state: session, changed: false, reason: `На клетке ${command.from} нет фигуры` };
    if (cell.color !== turn) {
      return {
        state: session,
        changed: false,
        reason: `Сейчас ход: ${colorName(turn)}. Фигурой другого цвета ходить нельзя`,
      };
    }
    // A piece with no legal moves may still have geometric ones that are all blocked by pins.
    // Asking that question first is what turns "нет ходов" into "король под шахом".
    const pinnedAnswer = explainRefusedMove(chess, command.from, command.to);
    return { state: session, changed: false, reason: pinnedAnswer };
  }
  const toLegal = fromLegal.filter((move) => move.to === command.to);
  if (toLegal.length === 0) {
    const answer = explainRefusedMove(chess, command.from, command.to);
    return { state: session, changed: false, reason: answer };
  }
  const needsPromotion = toLegal.some((move) => move.isPromotion());
  if (needsPromotion && !command.promotion) {
    return { state: session, changed: false, reason: "Пешке нужно выбрать фигуру для превращения" };
  }
  if (command.promotion && !["q", "r", "b", "n"].includes(command.promotion)) {
    return { state: session, changed: false, reason: "Превращение возможно только в ферзя, ладью, слона или коня" };
  }

  let played;
  try {
    played = chess.move({
      from: command.from,
      to: command.to,
      promotion: command.promotion,
    });
  } catch {
    return { state: session, changed: false, reason: "Так эта фигура не ходит" };
  }
  if (!played) return { state: session, changed: false, reason: "Так эта фигура не ходит" };

  const record: ChessMoveRecord = {
    ply: session.moves.length,
    from: played.from,
    to: played.to,
    piece: played.piece,
    color: played.color,
    captured: played.captured ?? null,
    promotion: played.promotion ?? null,
    san: played.san,
    fen: played.after,
    flags: {
      capture: played.isCapture(),
      enPassant: played.isEnPassant(),
      castle: played.isKingsideCastle() || played.isQueensideCastle(),
      bigPawn: played.isBigPawn(),
      promotion: played.isPromotion(),
    },
  };

  const halfmoveClock = clockFrom(played.after, 4);
  const fullmoveNumber = clockFrom(played.after, 5);
  const next: ChessSession = {
    ...session,
    moves: [...session.moves, record],
    positionKeys: [...session.positionKeys, chess.hash()],
    halfmoveClock,
    fullmoveNumber,
    // A move declines an outstanding offer in spirit; FIDE says by making a move the player
    // refuses it unless they claim the draw at that moment. Keeping a stale offer would let the
    // opponent accept a draw that was already declined.
    drawOffer: null,
  };

  const ending = settle(next, chess);
  return { state: ending, changed: true, move: record };
}

/**
 * Explains a refused move.
 *
 * The three reasons a player actually meets: the move leaves the king in check (usually a pin),
 * castling is not available right now, or the piece simply does not move that way. The difference
 * matters, because "так не ходит" in front of a pinned knight teaches the player nothing.
 */
function explainRefusedMove(chess: Chess, from: ChessSquare, to: ChessSquare): string {
  const cell = chess.get(from);
  if (!cell) return "На этой клетке нет фигуры";
  const files = "abcdefgh";
  const fileDelta = files.indexOf(to[0]) - files.indexOf(from[0]);
  const rankDelta = Number(to[1]) - Number(from[1]);

  if (cell.type === "k" && Math.abs(fileDelta) === 2 && rankDelta === 0) {
    return explainRefusedCastling(chess, from, fileDelta > 0);
  }
  if (!wouldBeLegalIgnoringPins(chess, from, to)) {
    if (cell.type === "p" && fileDelta !== 0 && !chess.get(to)) {
      return "Пешка бьёт только по диагонали и только фигуру или взятие на проходе";
    }
    return `Так ${pieceName(cell.type)} не ходит`;
  }
  return "Этот ход оставляет вашего короля под шахом";
}

/** Which condition stopped a castle, asked in the order a player would check them. */
function explainRefusedCastling(chess: Chess, from: ChessSquare, kingSide: boolean): string {
  const color = chess.turn();
  const homeRank = color === "w" ? "1" : "8";
  if (from !== `e${homeRank}`) return "Рокировка невозможна: король уже сходил со своего начального поля";
  if (chess.isCheck()) return "Рокировка невозможна: король под шахом";
  const rights = chess.getCastlingRights(color);
  const rookSquare = (`${kingSide ? "h" : "a"}${homeRank}`) as Square;
  if (!(kingSide ? rights.k : rights.q)) return "Рокировка невозможна: король или ладья уже двигались";
  if (chess.get(rookSquare)?.type !== "r") return "Рокировка невозможна: на начальном поле нет ладьи";
  const between = kingSide ? [`f${homeRank}`, `g${homeRank}`] : [`b${homeRank}`, `c${homeRank}`, `d${homeRank}`];
  if (between.some((square) => chess.get(square as Square))) return "Рокировка невозможна: между королём и ладьёй есть фигура";
  return "Рокировка невозможна: поле, через которое проходит король, атаковано";
}

/**
 * Whether the move would be legal if the mover's own king were out of the way.
 *
 * This is how a pin is told apart from "так эта фигура не ходит" without reading chess.js
 * internals. The king is moved one square, to the first empty neighbour, and the piece is asked
 * again: a pinned piece then has the move it was refused, while a piece that simply cannot go
 * there still has none. chess.js refuses a board without a king, so the king is relocated rather
 * than removed - removing it leaves the library's own king index pointing at a stale square.
 */
function wouldBeLegalIgnoringPins(chess: Chess, from: ChessSquare, to: ChessSquare): boolean {
  const cell = chess.get(from);
  if (!cell) return false;
  const ownKing = findKingSquare(chess, cell.color);
  if (!ownKing) return false;
  const files = "abcdefgh";
  for (const [df, dr] of [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
  ]) {
    const file = files.indexOf(ownKing[0]) + df;
    const rank = Number(ownKing[1]) + dr;
    if (file < 0 || file > 7 || rank < 1 || rank > 8) continue;
    const square = (`${files[file]}${rank}`) as Square;
    if (chess.get(square)) continue;
    const probe = new Chess(chess.fen(), { skipValidation: true });
    probe.remove(ownKing);
    probe.put({ color: cell.color, type: "k" }, square);
    const raw = probe.moves({ square: from, verbose: true });
    return raw.some((move) => move.to === to);
  }
  // A king boxed in by its own pieces leaves nowhere to try; the caller's generic answer stands.
  return false;
}

function findKingSquare(chess: Chess, color: Color): Square | null {
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === "k" && cell.color === color) return cell.square;
    }
  }
  return null;
}

const PIECE_NAMES: Record<ChessPieceType, string> = {
  p: "пешка",
  n: "конь",
  b: "слон",
  r: "ладья",
  q: "ферзь",
  k: "король",
};

export function pieceName(type: ChessPieceType): string {
  return PIECE_NAMES[type];
}

/**
 * Ends the game if the rules now say so.
 *
 * Order matters and is the order a player experiences: mate and stalemate first, then material,
 * then the automatic counters. A position that is both mate and "50 moves reached" is mate.
 */
function settle(session: ChessSession, chess: Chess): ChessSession {
  if (chess.isCheckmate()) {
    const winner = otherColor(chess.turn());
    return {
      ...session,
      endedBy: { type: "play" },
      result: { kind: "win", winnerId: winner, reason: "мат" },
    };
  }
  if (chess.isStalemate()) {
    return { ...session, endedBy: { type: "play" }, result: { kind: "draw", reason: "пат" } };
  }
  if (chess.isInsufficientMaterial()) {
    return { ...session, endedBy: { type: "play" }, result: { kind: "draw", reason: "недостаток материала для мата" } };
  }
  if (repetitionCount(session) >= DRAW_RULES.repetitionAutomatic) {
    return {
      ...session,
      endedBy: { type: "play" },
      result: { kind: "draw", reason: `${DRAW_RULES.repetitionAutomatic}-кратное повторение позиции` },
    };
  }
  if (session.halfmoveClock >= DRAW_RULES.halfmoveAutomatic) {
    return {
      ...session,
      endedBy: { type: "play" },
      result: { kind: "draw", reason: `${DRAW_RULES.halfmoveAutomatic / 2} ходов каждого без взятий и ходов пешками` },
    };
  }
  return session;
}

/**
 * Whether the game is waiting for the bot to move.
 *
 * The screen asks this after every change, and the bot's own turn goes through the same command
 * path as a click on the board: `applyChessCommand` checks legality, and the search only ever
 * offers moves it found as legal.
 */
export function isBotTurn(session: ChessSession): boolean {
  if (session.result || session.botColor === null) return false;
  return turnOf(session) === session.botColor;
}

/** The point value of the material on the board, for the result screen. */
export const PIECE_VALUE: Record<ChessPieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function capturedPieces(session: ChessSession, captureColor: Color): ChessPieceType[] {
  return session.moves
    .filter((move) => move.color === captureColor && move.captured)
    .map((move) => move.captured as ChessPieceType)
    .sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
}

/** The material balance from white's point of view, in pawns. */
export function materialBalance(session: ChessSession): number {
  const chess = toChess(session);
  let total = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      total += cell.color === "w" ? PIECE_VALUE[cell.type] : -PIECE_VALUE[cell.type];
    }
  }
  return Math.round(total / 100);
}

/** The move list, in the pairs a scoresheet shows. */
export function movePairs(
  session: ChessSession
): { number: number; white: ChessMoveRecord | null; black: ChessMoveRecord | null }[] {
  const pairs: { number: number; white: ChessMoveRecord | null; black: ChessMoveRecord | null }[] = [];
  for (const move of session.moves) {
    // The move number is the one chess.js wrote after the move. For a white move that is the
    // pair's own number; a black move belongs to the pair already open.
    const number = Number(move.fen.split(" ")[5]) || pairs.length + 1;
    if (move.color === "w") {
      pairs.push({ number, white: move, black: null });
    } else {
      const last = pairs[pairs.length - 1];
      if (last && last.black === null) last.black = move;
      else pairs.push({ number: Math.max(1, number - 1), white: null, black: move });
    }
  }
  return pairs;
}

/** A PGN document for the finished or unfinished game. */
export function toPgn(session: ChessSession, options: { event?: string; site?: string; date?: string } = {}): string {
  const chess = toChess(session);
  chess.setHeader("Event", options.event ?? "NEXUS Arcade");
  chess.setHeader("Site", options.site ?? "NEXUS messenger");
  chess.setHeader("Date", options.date ?? "????.??.??");
  chess.setHeader("White", session.players.white);
  chess.setHeader("Black", session.players.black);
  chess.setHeader("Result", pgnResult(session));
  chess.setHeader("RulesVersion", String(session.rulesVersion));
  if (session.botColor !== null) {
    chess.setHeader("Annotator", `NEXUS bot (${session.difficulty === "easy" ? "Начальный" : "Обычный"})`);
  }
  return chess.pgn({ maxWidth: 76, newline: "\n" });
}

export function pgnResult(session: ChessSession): string {
  if (!session.result) return "*";
  if (session.result.kind === "draw") return "1/2-1/2";
  return session.result.winnerId === "w" ? "1-0" : "0-1";
}

/**
 * The result, written for the person reading it.
 *
 * `viewer` is the colour the reader holds. In «два человека на одном устройстве» nobody holds a
 * single colour, so the sentence names the winner instead of addressing the reader.
 */
export function resultText(session: ChessSession, viewer: "w" | "b" | "both"): string {
  const result = session.result;
  if (!result) return "";
  if (result.kind === "draw") return `Ничья: ${result.reason}.`;
  const winner = result.winnerId === "w" ? "w" : "b";
  const winnerName = `${colorName(winner)} (${session.players[winner === "w" ? "white" : "black"]})`;
  if (viewer === winner) return `Вы выиграли: ${result.reason}. Победили ${winnerName}.`;
  if (viewer !== "both") return `Вы проиграли: ${result.reason}. Победили ${winnerName}.`;
  return `Победили ${winnerName}: ${result.reason}.`;
}

/** What the header says about the game in one line. */
export function statusLine(session: ChessSession, viewer: "w" | "b" | "both"): string {
  if (session.result) return "Партия закончена";
  const turn = turnOf(session);
  const base = session.botColor !== null && viewer !== "both" ? (turn === viewer ? "Ваш ход" : "Думает бот") : `Ход ${colorGenitive(turn)}`;
  if (session.drawOffer !== null) {
    const offer = session.drawOffer === viewer ? "Вы предложили ничью" : "Соперник предложил ничью";
    return `${base} · ${offer}`;
  }
  return base;
}

/** A one-line summary for the catalogue card, written from the state rather than stored. */
export function summaryOf(session: ChessSession): string {
  if (session.result) {
    if (session.result.kind === "draw") return `ничья · ${session.moves.length} ходов`;
    const winner = session.result.winnerId === "w" ? "белые" : "чёрные";
    return `${winner} победили · ${session.moves.length} ходов`;
  }
  const chess = toChess(session);
  const side = chess.turn() === "w" ? "белые" : "чёрные";
  return `${side}, ${chess.moveNumber()}-й ход · ${session.moves.length} ходов сделано`;
}

/** A colour chosen at random for the bot, from the injected generator so tests can pin it. */
export function botColorFrom(random: () => number): Color {
  return random() < 0.5 ? "w" : "b";
}
