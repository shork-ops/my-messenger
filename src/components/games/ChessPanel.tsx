/**
 * The chess screen.
 *
 * One panel that owns the parts of chess the other two games do not have: a promotion question, a
 * claimable draw that sits beside an automatic one, a resignation that ends the game, and a bot
 * whose move is calculated off the main thread.
 *
 * The layout order is deliberate. The board comes first because that is what the player came for;
 * the status line is above it so it cannot be scrolled away on a phone; the controls sit below the
 * board rather than beside it, because a phone has no side to put them on.
 *
 * The bot is asked for a move only when three things hold: the game is in bot mode, it is the
 * bot's turn, and the game is not over. Every request goes through the cancellable runner, so
 * closing the screen or starting another game abandons the search instead of letting a move land
 * in the wrong game.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  capturedPieces,
  CLAIM_TEXT,
  colorName,
  DRAW_RULES,
  drawClaimAvailable,
  materialBalance,
  movePairs,
  resultText,
  statusLine,
  viewPosition,
  type ChessCommand,
  type ChessPieceType,
  type ChessSession,
  type ChessSquare,
  type Color,
} from "../../games/chess/session";
import { isAnswerLegal } from "../../games/chess/bot";
import type { BotRunner } from "../../games/chess/useChessBot";
import ChessBoard, { PromotionPicker } from "./ChessBoard";

const GLYPH: Record<ChessPieceType, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

export type ChessPanelProps = {
  session: ChessSession;
  /** Which colour the person at the screen holds, or "both" when two people share it. */
  viewer: Color | "both";
  /** True while the screen is on show; the bot does not think when it is hidden. */
  active: boolean;
  bot: BotRunner;
  onCommand: (command: ChessCommand) => void;
  onNewGame: () => void;
  onExit: () => void;
};

export default function ChessPanel({
  session,
  viewer,
  active,
  bot,
  onCommand,
  onNewGame,
  onExit,
}: ChessPanelProps) {
  const view = useMemo(() => viewPosition(session), [session]);
  const [thinking, setThinking] = useState(false);
  const [promotion, setPromotion] = useState<{ from: ChessSquare; to: ChessSquare } | null>(null);
  const [notice, setNotice] = useState("");

  const turn = view.turn;
  const finished = session.result !== null;
  // One person at the phone moves one colour in a bot game, both colours otherwise.
  const movable: Color | "both" = viewer;
  const myTurn = !finished && (movable === "both" || movable === turn);
  const botColor = session.botColor;
  /** The colour a command should be attributed to: whoever is to move. */
  const actor: Color = turn;

  const lastMove = useMemo(() => {
    const last = session.moves[session.moves.length - 1];
    return last ? { from: last.from as ChessSquare, to: last.to as ChessSquare } : null;
  }, [session.moves]);

  const botShouldMove = active && !finished && botColor !== null && turn === botColor;

  useEffect(() => {
    if (!botShouldMove) {
      setThinking(false);
      return;
    }
    let live = true;
    const fen = view.fen;
    const gameStart = session.startedAt;
    setThinking(true);
    void bot.request(fen, session.difficulty).then((answer) => {
      if (!live) return;
      setThinking(false);
      if (!answer || !answer.move) {
        setNotice("Бот не нашёл хода в этой позиции.");
        return;
      }
      // The answer is re-checked against the position it was asked about: a search cancelled early
      // can still produce something, and a move for a position that no longer exists must never
      // reach the board.
      if (!isAnswerLegal(fen, answer)) {
        setNotice("Ответ бота не подошёл к позиции и не был применён.");
        return;
      }
      if (gameStart !== session.startedAt) return;
      const move = answer.move;
      onCommand({ type: "move", from: move.from, to: move.to, promotion: move.promotion });
    });
    return () => {
      // Leaving the effect - a new position, a closed screen - abandons the search in flight.
      live = false;
      bot.cancel();
    };
  }, [botShouldMove, bot, onCommand, session.difficulty, session.startedAt, view.fen]);

  // A new game is a new position; a notice about the old one must not survive into it.
  const startRef = useRef(session.startedAt);
  useEffect(() => {
    if (startRef.current !== session.startedAt) {
      startRef.current = session.startedAt;
      setNotice("");
      setPromotion(null);
    }
  }, [session.startedAt]);

  const claim = drawClaimAvailable(session, actor);
  const viewerName = viewer === "both" ? "both" : viewer;
  const outcome = resultText(session, viewerName);

  const handleMove = useCallback(
    (move: { from: ChessSquare; to: ChessSquare; promotion?: ChessPieceType }) => {
      setNotice("");
      onCommand({ type: "move", from: move.from, to: move.to, promotion: move.promotion });
    },
    [onCommand]
  );

  return (
    <div className="chess-panel">
      <p className={`chess-status ${myTurn && !finished ? "chess-status-you" : ""}`} role="status">
        {statusLine(session, viewerName)}
        {thinking && " · бот думает…"}
      </p>

      <ChessBoard
        view={view}
        movable={movable}
        orientation={viewer === "b" ? "b" : "w"}
        disabled={!myTurn || thinking}
        lastMove={lastMove}
        onPromote={setPromotion}
        onMove={handleMove}
      />

      {promotion && (
        <PromotionPicker
          color={turn}
          onChoose={(piece) => {
            const move = promotion;
            setPromotion(null);
            if (move) handleMove({ ...move, promotion: piece });
          }}
          onCancel={() => setPromotion(null)}
        />
      )}

      <div className="chess-capture-rows">
        <CaptureRow label="Вы взяли" pieces={capturedPieces(session, viewer === "b" ? "b" : "w")} />
        <CaptureRow label="Вас взяли" pieces={capturedPieces(session, viewer === "b" ? "w" : "b")} />
        <span className="chess-material">{materialText(session)}</span>
      </div>

      {session.drawOffer !== null && !finished && (
        <p className="chess-offer game-hint">
          {session.drawOffer === turn ? "Соперник предложил ничью." : "Вы предложили ничью."}
          {session.drawOffer === turn && (
            <button type="button" className="btn btn-ghost" onClick={() => onCommand({ type: "accept-draw", by: actor })}>
              Принять
            </button>
          )}
        </p>
      )}

      {notice && (
        <p className="game-notice" role="alert">
          {notice}
        </p>
      )}

      {finished ? (
        <div className="chess-finished" role="status">
          <p className="chess-outcome">{outcome}</p>
          <div className="chess-controls">
            <button type="button" className="btn btn-primary" onClick={onNewGame}>
              Новая партия
            </button>
            <button type="button" className="btn btn-ghost" onClick={onExit}>
              К списку игр
            </button>
          </div>
        </div>
      ) : (
        <div className="chess-controls">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!claim.allowed}
            title={claim.allowed && claim.basis ? CLAIM_TEXT[claim.basis] : claim.reason}
            onClick={() => onCommand({ type: "claim-draw", by: actor })}
          >
            {claim.allowed ? "Заявить ничью" : `Ничья (${DRAW_RULES.repetitionClaim})`}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={session.drawOffer !== null}
            onClick={() => onCommand({ type: "offer-draw", by: actor })}
          >
            Предложить ничью
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onCommand({ type: "resign", by: actor })}>
            Сдаться
          </button>
        </div>
      )}

      <MoveSheet session={session} />

      <p className="game-hint">
        {/* The session records the bot's colour rather than a mode string, so that is what the
            hint is written from: a game with a bot seat is a game with a bot seat. */}
        {botColor !== null
          ? `Бот играет ${colorName(botColor)}. Уровень: ${
              session.difficulty === "easy" ? "Начальный" : "Обычный"
            }.`
          : "Два игрока за одним устройством: ход передаётся по очереди."}
      </p>
    </div>
  );
}

/** The captured pieces, as the glyphs a player recognises. */
function CaptureRow({ label, pieces }: { label: string; pieces: ChessPieceType[] }) {
  return (
    <span className="chess-captured">
      <span className="chess-captured-label">{label}:</span>
      <span className="chess-captured-pieces" aria-hidden="true">
        {pieces.length === 0 ? "—" : pieces.map((piece, index) => <span key={`${piece}${index}`}>{GLYPH[piece]}</span>)}
      </span>
    </span>
  );
}

/** Material balance in pawns, said as a number rather than a vague "better position". */
export function materialText(session: ChessSession): string {
  const balance = materialBalance(session);
  if (balance === 0) return "Материал равный";
  const leading = balance > 0 ? "Белые" : "Чёрные";
  const units = Math.abs(balance);
  // «на 1 пешку», «на 2 пешки», «на 5 пешек»: the noun has to agree with the number.
  const lastTwo = units % 100;
  const lastOne = units % 10;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "пешек"
      : lastOne === 1
        ? "пешку"
        : lastOne >= 2 && lastOne <= 4
          ? "пешки"
          : "пешек";
  return `${leading} впереди на ${units} ${word}`;
}

/** The scoresheet, in the pairs a player reads. */
export function MoveSheet({ session }: { session: ChessSession }) {
  const pairs = movePairs(session);
  if (pairs.length === 0) return <p className="game-hint">Ходов пока нет.</p>;
  return (
    <ol className="chess-moves">
      {pairs.map((pair) => (
        <li key={pair.number}>
          <span className="chess-move-number">{pair.number}.</span>
          <span>{pair.white?.san ?? "…"}</span>
          <span>{pair.black?.san ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}

export { materialBalance };
