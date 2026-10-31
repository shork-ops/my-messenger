/**
 * The games screen: a catalogue and one shared game screen.
 *
 * The previous version had three separate blocks of markup, one per game, each drawing a
 * placeholder. This has one screen that renders whichever game is open, because the three
 * placeholders had already drifted apart and each would otherwise grow its own copy of the
 * header, the notice line and the close button.
 */

import { useEffect } from "react";
import { ChevronRight, RotateCcw, X } from "lucide-react";
import { games } from "../lib/constants";
import type { GameKind, PlayMode } from "../games/core/types";
import { COLOR_LABEL, canPlay, currentPlayer, type CardColor } from "../games/cards/deck";
import { DICTIONARY_VERSION, dictionaryReady, dictionarySize } from "../games/balda/dictionary";
import ChessBoard, { MoveList, materialText } from "./games/ChessBoard";
import CardTable from "./games/CardTable";
import BaldaBoard from "./games/BaldaBoard";
import { DIFFICULTY_LABEL as CHESS_DIFFICULTY } from "../games/chess/bot";
import { useGameSessions, type OpenGame } from "../games/core/useGameSessions";

/** The catalogue name of each game, and back. The catalogue is the source of the names. */
const KIND_BY_NAME: Record<string, GameKind> = {
  Шахматы: "chess",
  Uno: "cards",
  Балда: "balda",
};

const NAME_BY_KIND: Record<GameKind, string> = {
  chess: "Шахматы",
  cards: "Uno",
  balda: "Балда",
};

const MODE_LABEL: Record<PlayMode, string> = {
  bot: "С ботом",
  local: "На одном устройстве",
  friend: "С другом",
};

/** The third mode needs a server to hold the game; it is shown disabled rather than hidden. */
const MODE_AVAILABLE: Record<PlayMode, boolean> = { bot: true, local: true, friend: false };

type GameModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function GameModal({ open, onClose }: GameModalProps) {
  const sessions = useGameSessions();

  // Escape closes the screen, which is what every other overlay in the app does.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = sessions.open;

  if (!current) {
    return (
      <div className="modal-backdrop game-backdrop" onClick={onClose}>
        <section className="game-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Мини-игры">
          <header className="game-modal-header">
            <div>
              <span className="game-modal-eyebrow">NEXUS ARCADE</span>
              <h2>Мини-игры</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Закрыть игры">
              <X size={20} />
            </button>
          </header>

          <div className="game-picker">
            {games.map((game) => {
              const kind = KIND_BY_NAME[game.name];
              const saved = kind ? sessions.unfinished[kind] : undefined;
              return (
                <div key={game.name} className="game-picker-card">
                  <span className={`game-icon ${game.cls}`}>{game.icon}</span>
                  <strong>{game.name}</strong>
                  <small>{game.desc}</small>

                  {saved ? (
                    <div className="game-picker-saved">
                      <span className="game-picker-saved-what">{saved.summary}</span>
                      <div className="game-picker-buttons">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => kind && sessions.resume(kind)}
                        >
                          Продолжить
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            if (kind) sessions.forget(saved.gameId);
                          }}
                          aria-label={`Забыть сохранённую партию в ${game.name}`}
                        >
                          <RotateCcw size={14} /> Новая
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="game-play-label"
                      onClick={() => kind && sessions.start(kind, "bot")}
                    >
                      Играть <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {sessions.notice && (
            <p className="game-notice" role="alert">
              {sessions.notice}
            </p>
          )}

          <p className="game-hint">
            «С другом» появится, когда у игры появится серверная комната: сейчас сетевой партии нет.
          </p>
        </section>
      </div>
    );
  }

  const name = NAME_BY_KIND[current.kind];

  return (
    <div className="modal-backdrop game-backdrop" onClick={onClose}>
      <section className="game-modal game-modal-playing" onClick={(event) => event.stopPropagation()} role="dialog" aria-label={name}>
        <header className="game-modal-header">
          <div>
            <span className="game-modal-eyebrow">
              {name} · {MODE_LABEL[current.mode]}
            </span>
            <h2>{headline(current)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть игру">
            <X size={20} />
          </button>
        </header>

        {sessions.notice && (
          <p className="game-notice" role="alert">
            {sessions.notice}
          </p>
        )}

        {current.kind === "chess" && (
          <div className="chess-game">
            <ChessBoard
              state={current.state}
              playerColor="w"
              disabled={Boolean(current.state.result) || current.state.turn === "b"}
              onMove={(move) => sessions.applyChess({ type: "move", from: move.from, to: move.to, promotion: move.promotion })}
            />
            <div className="chess-side">
              <p className="game-hint">{materialText(current.state)}</p>
              <p className="game-hint">
                Уровень бота: {CHESS_DIFFICULTY[current.difficulty]}
              </p>
              <MoveList state={current.state} />
              <div className="chess-controls">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => sessions.applyChess({ type: "resign" })}
                  disabled={Boolean(current.state.result)}
                >
                  Сдаться
                </button>
                <button type="button" className="btn btn-ghost" onClick={sessions.playBot} disabled={Boolean(current.state.result)}>
                  Ход бота
                </button>
              </div>
            </div>
          </div>
        )}

        {current.kind === "cards" && (
          <CardTable
            state={current.state}
            playerId={currentPlayer(current.state)}
            hidden={false}
            onPlay={(cardId) => {
              const card = current.state.cards[cardId];
              if (card.color === null) {
                sessions.applyCards({ type: "play", cardId, chooseColor: current.state.activeColor });
              } else {
                sessions.applyCards({ type: "play", cardId });
              }
            }}
            onDraw={() => sessions.applyCards({ type: "draw" })}
            onPass={() => sessions.applyCards({ type: "pass" })}
            onChallenge={() => sessions.applyCards({ type: "challenge" })}
            onOneCard={() => sessions.applyCards({ type: "one-card", playerId: "Вы" })}
            onChooseColour={(colour: CardColor) => {
              const pending = current.state.pending;
              if (pending) {
                sessions.applyCards({ type: "play", cardId: pending.cardId, chooseColor: colour });
              }
            }}
            disabled={Boolean(current.state.result)}
          />
        )}

        {current.kind === "balda" && (
          <div className="balda-game">
            {!dictionaryReady() ? (
              <p className="game-notice" role="alert">
                Словарь не загрузился. Без него партию начинать нельзя: любое слово считалось бы верным.
              </p>
            ) : (
              <>
                <BaldaBoard
                  state={current.state}
                  disabled={Boolean(current.state.result)}
                  onPlay={(square, letter, word) => sessions.applyBalda({ type: "place", square, letter, word })}
                />
                <div className="balda-side">
                  <p className="balda-score">
                    Счёт: {current.state.scores[0]} : {current.state.scores[1]}
                  </p>
                  <p className="game-hint">Слов в словаре: {dictionarySize()} (версия {DICTIONARY_VERSION})</p>
                  <p className="game-hint">Уровень бота: {current.difficulty === "easy" ? "Начальный" : "Обычный"}</p>
                  <div className="chess-controls">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => sessions.applyBalda({ type: "pass" })}
                      disabled={Boolean(current.state.result)}
                    >
                      Пропустить
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => sessions.applyBalda({ type: "resign" })}
                      disabled={Boolean(current.state.result)}
                    >
                      Сдаться
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {resultText(current) && (
          <p className="game-result" role="status">
            {resultText(current)}
          </p>
        )}
      </section>
    </div>
  );
}

/** What the header says: the state of the game, or the result of it. */
function headline(current: OpenGame | null): string {
  if (!current) return "Мини-игры";
  const result = resultOf(current);
  if (result) return "Партия закончена";
  if (current.kind === "chess") return current.state.turn === "w" ? "Ход белых" : "Ход чёрных";
  if (current.kind === "cards") return `Ход: ${currentPlayer(current.state)}`;
  return current.state.turnIndex === 0 ? "Ход первого игрока" : "Ход второго игрока";
}

function resultOf(current: OpenGame) {
  if (current.kind === "chess") return current.state.result;
  if (current.kind === "cards") return current.state.result;
  return current.state.result;
}

/** The result line, worded from the result the engine produced rather than guessed at. */
function resultText(current: OpenGame | null): string {
  if (!current) return "";
  const result = resultOf(current);
  if (!result) return "";
  if (result.kind === "draw") return `Ничья: ${result.reason}.`;
  const winner = result.winnerId === "player-1" ? "первый игрок" : result.winnerId === "player-2" ? "второй игрок" : result.winnerId;
  return `Победил ${winner}: ${result.reason}.`;
}

export { KIND_BY_NAME, NAME_BY_KIND, MODE_AVAILABLE, MODE_LABEL, canPlay, COLOR_LABEL };
