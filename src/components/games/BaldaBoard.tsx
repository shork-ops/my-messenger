/**
 * The «Балда» board.
 *
 * Play is: press an empty square, type the letter, and the word. The board shows which squares
 * are legal places for a letter, so a player never types a letter and then learns it could not
 * go there.
 */

import { useMemo, useState } from "react";
import {
  BOARD_SIZE,
  neighbours,
  playableSquares,
  type BaldaState,
} from "../../games/balda/engine";
import { normalise } from "../../games/balda/dictionary";

type BaldaBoardProps = {
  state: BaldaState;
  disabled?: boolean;
  onPlay: (square: number, letter: string, word: string) => void;
};

export default function BaldaBoard({ state, disabled = false, onPlay }: BaldaBoardProps) {
  const [square, setSquare] = useState<number | null>(null);
  const [letter, setLetter] = useState("");
  const [word, setWord] = useState("");
  const [error, setError] = useState("");

  const playable = useMemo(() => new Set(playableSquares(state.board)), [state.board]);
  const canPlay = !disabled && !state.result;

  function pick(index: number) {
    if (!canPlay) return;
    if (state.board[index] !== null) return;
    if (!playable.has(index)) {
      setError("Букву можно поставить только рядом с уже стоящими буквами.");
      return;
    }
    setError("");
    setSquare(index);
    setLetter("");
    setWord("");
  }

  function submit() {
    if (square === null) {
      setError("Сначала выберите пустую клетку.");
      return;
    }
    const cleanLetter = normalise(letter);
    if (!/^[а-я]$/.test(cleanLetter)) {
      setError("Введите одну русскую букву.");
      return;
    }
    const cleanWord = normalise(word);
    if (cleanWord.length < 2) {
      setError("Слово должно состоять хотя бы из двух букв.");
      return;
    }
    setError("");
    onPlay(square, cleanLetter, cleanWord);
    setSquare(null);
    setLetter("");
    setWord("");
  }

  return (
    <div className="balda-wrap">
      <div className="balda-board" role="grid" aria-label={`Поле ${BOARD_SIZE} на ${BOARD_SIZE}`}>
        {state.board.map((cell, index) => {
          const isPlayable = playable.has(index);
          const isSelected = square === index;
          return (
            <button
              key={index}
              type="button"
              role="gridcell"
              className={[
                "balda-cell",
                cell ? "balda-filled" : "",
                isPlayable ? "balda-playable" : "",
                isSelected ? "balda-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={
                cell ? `Клетка ${index + 1}, буква ${cell}` : `Пустая клетка ${index + 1}${isPlayable ? ", можно поставить букву" : ""}`
              }
              aria-pressed={isSelected}
              disabled={!canPlay || cell !== null || !isPlayable}
              onClick={() => pick(index)}
            >
              {cell ?? (isPlayable ? "·" : "")}
            </button>
          );
        })}
      </div>

      <div className="balda-form">
        <label>
          Буква
          <input
            type="text"
            inputMode="text"
            maxLength={2}
            value={letter}
            disabled={!canPlay || square === null}
            onChange={(event) => setLetter(event.target.value)}
            placeholder="а"
            aria-label="Буква, которую вы ставите"
          />
        </label>
        <label>
          Слово
          <input
            type="text"
            value={word}
            disabled={!canPlay || square === null}
            onChange={(event) => setWord(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="слово целиком"
            aria-label="Слово, которое получилось"
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!canPlay || square === null}>
          Поставить
        </button>
      </div>

      {error && (
        <p className="game-notice" role="alert">
          {error}
        </p>
      )}
      {square !== null && (
        <p className="game-hint">
          Клетка {square + 1}: рядом {neighbours(square).filter((n) => state.board[n]).map((n) => state.board[n]).join(", ") || "пусто"}
        </p>
      )}
    </div>
  );
}
