/**
 * The chess board.
 *
 * A board that shows pieces is not a chess game: this one has to be playable with a keyboard,
 * because a grid of 64 buttons is unusable with a mouse alone and unreadable with a screen
 * reader unless each square says what is on it and what can be done with it.
 *
 * Colours are never the only signal. A selected square has a border, a legal destination has a
 * dot, and the last move has a ring - so the board still works for a player who cannot tell the
 * light and dark squares apart.
 */

import { useMemo, useState } from "react";
import {
  fileOf,
  legalMoves,
  movesFrom,
  otherColor,
  PIECE_VALUE,
  squareName,
  type ChessMove,
  type ChessState,
  type Color,
  type Piece,
  type PieceType,
} from "../../games/chess/engine";

const GLYPH: Record<PieceType, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const NAME: Record<PieceType, string> = {
  k: "король",
  q: "ферзь",
  r: "ладья",
  b: "слон",
  n: "конь",
  p: "пешка",
};

export function squareLabel(piece: Piece | null, index: number): string {
  const square = squareName(index);
  if (!piece) return square;
  const colour = piece.color === "w" ? "белый" : "чёрный";
  return `${square}, ${colour} ${NAME[piece.type]}`;
}

type ChessBoardProps = {
  state: ChessState;
  /** The colour the person at the screen is playing; only their pieces may be moved. */
  playerColor: Color;
  disabled?: boolean;
  onMove: (move: ChessMove) => void;
};

export default function ChessBoard({ state, playerColor, disabled = false, onMove }: ChessBoardProps) {
  const [selected, setSelected] = useState<number | null>(null);

  const moves = useMemo(() => {
    if (selected === null) return [] as ChessMove[];
    return movesFrom(state, selected);
  }, [state, selected]);

  const last = state.history[state.history.length - 1];
  const lastSquares = last ? [last.move.from, last.move.to] : [];
  const checkSquare = useMemo(() => {
    if (!state.result && state.turn) {
      // Highlight the king under attack, when the position is one where that is known.
      const king = state.board.findIndex((piece) => piece?.type === "k" && piece.color === state.turn);
      if (king >= 0) {
        const attacked = legalMoves({ ...state, turn: otherColor(state.turn) }).some(
          (move) => move.to === king
        );
        if (attacked) return king;
      }
    }
    return null;
  }, [state]);

  function activate(index: number) {
    if (disabled || state.result) return;
    const piece = state.board[index];

    if (selected === null) {
      if (!piece || piece.color !== state.turn || piece.color !== playerColor) return;
      setSelected(index);
      return;
    }

    if (index === selected) {
      setSelected(null);
      return;
    }

    const candidate = moves.find((move) => move.to === index);
    if (candidate) {
      onMove({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
      setSelected(null);
      return;
    }

    // Clicking another own piece selects it instead, which is how a player corrects a mistake.
    if (piece && piece.color === state.turn && piece.color === playerColor) {
      setSelected(index);
      return;
    }
    setSelected(null);
  }

  const destinations = new Set(moves.map((move) => move.to));

  return (
    <div className="chess-board-wrap">
      <div className="chess-board" role="grid" aria-label="Шахматная доска">
        {state.board.map((piece, index) => {
          const square = squareName(index);
          const light = (fileOf(index) + Math.floor(index / 8)) % 2 === 1;
          const isSelected = selected === index;
          const isDestination = destinations.has(index);
          const isLast = lastSquares.includes(index);
          const isCheck = checkSquare === index;
          // A square may only be focused if it is a piece of the side to move or a destination.
          const interactive =
            !state.result &&
            !disabled &&
            ((piece !== null && piece.color === state.turn && piece.color === playerColor) ||
              (isDestination && selected !== null));

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
              aria-label={squareLabel(piece, index)}
              aria-pressed={isSelected}
              aria-disabled={!interactive}
              tabIndex={interactive ? 0 : -1}
              onClick={() => activate(index)}
            >
              {piece && (
                <span
                  className={`chess-piece ${piece.color === "w" ? "chess-white" : "chess-black"}`}
                  aria-hidden="true"
                >
                  {GLYPH[piece.type]}
                </span>
              )}
              {isDestination && <span className="chess-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The move list in pairs, as a scoresheet reads. The engine supplies the notation. */
export function MoveList({ state }: { state: ChessState }) {
  const lines: { number: number; white?: string; black?: string }[] = [];
  state.history.forEach((record, index) => {
    // White moves first, so even indexes are White's moves. The record does not carry a colour
    // or a move number, and deriving them here keeps one source of truth instead of two.
    if (index % 2 === 0) lines.push({ number: Math.floor(index / 2) + 1, white: record.san });
    else lines[lines.length - 1].black = record.san;
  });

  if (lines.length === 0) return <p className="game-hint">Ходов пока нет.</p>;
  return (
    <ol className="chess-moves">
      {lines.map((line) => (
        <li key={line.number}>
          <span className="chess-move-number">{line.number}.</span>
          <span>{line.white ?? "…"}</span>
          <span>{line.black ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}

/** Material balance in pawns, shown as an honest number rather than a vague advantage. */
export function materialText(state: ChessState): string {
  const score = (colour: Color) =>
    state.board.reduce((total, piece) => (piece && piece.color === colour ? total + PIECE_VALUE[piece.type] : total), 0);
  const diff = Math.round((score("w") - score("b")) / 100);
  if (diff === 0) return "Материал равный";
  return diff > 0 ? `Белые впереди на ${diff}` : `Чёрные впереди на ${-diff}`;
}
