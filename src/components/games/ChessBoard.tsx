/**
 * The chess board.
 *
 * A board that shows pieces is not a chess game. This one has to work with a finger and with a
 * mouse, tell a player what they may legally do without them having to try it, and say out loud
 * what is on a square for a screen reader. So:
 *
 * - every square is a button, so a tap and a click are the same event and no separate touch code
 *   exists to drift out of step with the mouse code;
 * - the pieces the player may move are the only ones with a tab stop, and a selected piece shows
 *   its legal destinations as dots (empty squares) or rings (captures);
 * - colour is never the only signal: selection is a border, the last move is an outline, and the
 *   king in check is marked with a shape;
 * - a promotion is a question, not a default. The board reports that one is needed and the screen
 *   asks which piece; the move is only made once the player answers.
 *
 * The board draws one position and knows nothing about whose turn it is in the wider game; the
 * screen passes `movable`, so the same component draws both a bot game and two people sharing a
 * phone.
 */

import { useMemo, useState } from "react";
import type {
  ChessPieceType,
  ChessPositionView,
  ChessSquare,
  Color,
} from "../../games/chess/session";

const GLYPH: Record<ChessPieceType, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

/** Feminine nouns among the pieces: «ладья», «пешка». The rest are masculine. */
const FEMININE = new Set<ChessPieceType>(["r", "p"]);

export const PIECE_WORDS: Record<ChessPieceType, string> = {
  k: "король",
  q: "ферзь",
  r: "ладья",
  b: "слон",
  n: "конь",
  p: "пешка",
};

/** «белая ладья», but «белый конь»: the adjective has to agree with the noun. */
export function pieceWord(type: ChessPieceType, color: Color): string {
  const feminine = FEMININE.has(type);
  const adjective = color === "w" ? (feminine ? "белая" : "белый") : feminine ? "чёрная" : "чёрный";
  return `${adjective} ${PIECE_WORDS[type]}`;
}

/** What a square is called for a screen reader. Never just a coordinate. */
export function squareLabel(
  cell: { type: ChessPieceType; color: Color } | null,
  square: ChessSquare,
  options: { destination?: boolean; capture?: boolean; selected?: boolean; last?: boolean; check?: boolean } = {}
): string {
  const parts: string[] = [];
  parts.push(cell ? `${square}, ${pieceWord(cell.type, cell.color)}` : `${square}, пусто`);
  if (options.selected) parts.push("выбрано");
  if (options.check) parts.push("король под шахом");
  if (options.last) parts.push("последний ход");
  if (options.destination) parts.push(options.capture ? "можно взять" : "можно пойти");
  return parts.join(", ");
}

/** The rows and files as a player reads them, for the coordinate strips. */
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

export type ChessBoardProps = {
  view: ChessPositionView;
  /** The colour whose pieces the person at the screen may pick up. */
  movable: Color | "both";
  /** Which way round to draw the board: the colour at the bottom. */
  orientation: Color;
  disabled?: boolean;
  /** The square of the last move, for the outline. */
  lastMove?: { from: ChessSquare; to: ChessSquare } | null;
  /**
   * Called for a move that would promote.
   *
   * A promotion is a question, and the screen owns the answer: the board reports that one is
   * needed and the panel asks, so the dialog and the move it produces live in one place instead of
   * each holding half of the same pending move.
   */
  onPromote: (move: { from: ChessSquare; to: ChessSquare }) => void;
  onMove: (move: { from: ChessSquare; to: ChessSquare; promotion?: ChessPieceType }) => void;
};

export default function ChessBoard({
  view,
  movable,
  orientation,
  disabled = false,
  lastMove = null,
  onPromote,
  onMove,
}: ChessBoardProps) {
  const [selected, setSelected] = useState<ChessSquare | null>(null);

  const movesFromSelected = useMemo(() => {
    if (!selected) return [];
    return view.moves.filter((move) => move.from === selected);
  }, [view.moves, selected]);

  // A square may only be picked up when it holds a piece of the side to move that this person is
  // allowed to move. In bot mode that is one colour; with two people at the phone it is both.
  function canPickUp(square: ChessSquare, type: ChessPieceType | null, color: Color | null): boolean {
    if (disabled) return false;
    if (!type || !color) return false;
    if (color !== view.turn) return false;
    return movable === "both" || movable === color;
  }

  function activate(square: ChessSquare, cell: { type: ChessPieceType; color: Color } | null) {
    if (disabled) return;

    // Second tap: a legal destination. A promotion is handed to the screen, which asks which piece
    // before the move is made - a default would silently pick the queen for the player.
    const candidate = movesFromSelected.filter((move) => move.to === square);
    if (selected && candidate.length > 0) {
      if (candidate.some((move) => move.promotion)) {
        onPromote({ from: selected, to: square });
        setSelected(null);
        return;
      }
      onMove({ from: selected, to: square });
      setSelected(null);
      return;
    }

    if (selected === square) {
      setSelected(null);
      return;
    }

    if (canPickUp(square, cell?.type ?? null, cell?.color ?? null)) {
      setSelected(square);
      return;
    }
    setSelected(null);
  }

  const destinations = new Map(movesFromSelected.map((move) => [move.to, move.capture]));
  // The board is chess.js's own: row 0 is the eighth rank. Flipping is a sort, not a re-index, so
  // a square's name comes from the data rather than from arithmetic that could drift.
  const rows = view.board.map((row, index) => ({ row, rank: RANKS[index] }));
  const drawn = orientation === "w" ? rows : rows.slice().reverse();
  const files = orientation === "w" ? FILES : FILES.slice().reverse();

  return (
    <div className="chess-board-wrap">
      <div className="chess-board" role="grid" aria-label="Шахматная доска">
        {drawn.map(({ row, rank }) => {
          const cells = orientation === "w" ? row : row.slice().reverse();
          return cells.map((cell, column) => {
            const square = (cell?.square ?? `${files[column]}${rank}`) as ChessSquare;
            const fileIndex = FILES.indexOf(square[0]);
            const rankIndex = RANKS.indexOf(square[1]);
            // a8 is dark: the file and the rank that make the square light have the same parity.
            const light = (fileIndex + rankIndex) % 2 === 1;
            const isSelected = selected === square;
            const isDestination = destinations.has(square);
            const isLast = lastMove !== null && (lastMove.from === square || lastMove.to === square);
            const isCheck = view.checkSquare === square;
            const interactive = canPickUp(square, cell?.type ?? null, cell?.color ?? null) || isDestination;

            const classes = [
              "chess-square",
              light ? "chess-light" : "chess-dark",
              isSelected ? "chess-selected" : "",
              isDestination ? "chess-destination" : "",
              isLast ? "chess-last" : "",
              isCheck ? "chess-check" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={square}
                type="button"
                role="gridcell"
                className={classes}
                aria-label={squareLabel(cell, square, {
                  destination: isDestination,
                  capture: destinations.get(square) ?? false,
                  selected: isSelected,
                  last: isLast,
                  check: isCheck,
                })}
                aria-pressed={isSelected}
                tabIndex={interactive ? 0 : -1}
                onClick={() => activate(square, cell)}
              >
                {/* Coordinates on the edge only: a label on all 64 squares is noise. */}
                {column === 0 && <span className="chess-rank" aria-hidden="true">{rank}</span>}
                {cell && (
                  <span
                    className={`chess-piece ${cell.color === "w" ? "chess-white" : "chess-black"}`}
                    aria-hidden="true"
                  >
                    {GLYPH[cell.type]}
                  </span>
                )}
                {isDestination && !cell && <span className="chess-dot" aria-hidden="true" />}
                {isDestination && cell && <span className="chess-ring" aria-hidden="true" />}
              </button>
            );
          });
        })}
      </div>
      <div className="chess-files" aria-hidden="true">
        {files.map((file) => (
          <span key={file}>{file}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * The promotion question.
 *
 * A dialog rather than four buttons in the corner, because the choice decides whether the move is
 * a mate: a player who promoted to a knight by accident has lost a winning position and cannot take
 * it back.
 */
export function PromotionPicker({
  color,
  onChoose,
  onCancel,
}: {
  color: Color;
  onChoose: (piece: ChessPieceType) => void;
  onCancel: () => void;
}) {
  const choices: ChessPieceType[] = ["q", "r", "b", "n"];
  return (
    <div className="chess-promotion" role="dialog" aria-label="Превращение пешки">
      <p>Выберите фигуру для превращения</p>
      <div className="chess-promotion-choices">
        {choices.map((piece) => (
          <button
            key={piece}
            type="button"
            className={`chess-promotion-piece ${color === "w" ? "chess-white" : "chess-black"}`}
            aria-label={pieceWord(piece, color)}
            onClick={() => onChoose(piece)}
          >
            {GLYPH[piece]}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}
