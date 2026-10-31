/**
 * The games screen: a catalogue and one shared game screen.
 *
 * Two games are opened the same way but played very differently. Uno and Балда are drawn by their
 * own components and keep the shape they had; chess is drawn by `ChessPanel`, which needs a
 * cancellable bot, a promotion question and a saved scoresheet. What stays shared is the part that
 * had already drifted apart before: the header, the notice line, the close button and the storage.
 */

import { useEffect, useState } from "react";
import { ChevronRight, RotateCcw, X } from "lucide-react";
import { games } from "../lib/constants";
import type { GameKind, PlayMode } from "../games/core/types";
import { COLOR_LABEL, canPlay, currentPlayer, type CardColor } from "../games/cards/deck";
import { DICTIONARY_VERSION, dictionaryLoaded, dictionarySize, loadDictionary } from "../games/balda/dictionary";
import CardTable from "./games/CardTable";
import BaldaBoard from "./games/BaldaBoard";
import ChessPanel from "./games/ChessPanel";
import { DIFFICULTY_LABEL as CHESS_DIFFICULTY } from "../games/chess/bot";
import { CHESS_RULES } from "../games/chess/session";
import { useChessBot } from "../games/chess/useChessBot";
import { useGameSessions, type OpenGame } from "../games/core/useGameSessions";
import type { GameInvitation } from "../games/core/invitation";
import { useNetworkedGame } from "../games/core/useNetworkedGame";
import NetworkedGamePanel from "./games/NetworkedGamePanel";

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

/**
 * Which play modes this build can offer a signed-out visitor.
 *
 * "With a friend" needs a server to hold the shared game, so it is shown disabled rather than hidden
 * - hiding it would leave the player wondering whether the feature exists. `modeAvailable` below
 * turns it on once an account is signed in.
 */
const MODE_AVAILABLE: Record<PlayMode, boolean> = { bot: true, local: true, friend: false };

/**
 * Whether a mode can be offered right now.
 *
 * A shared game is a server row owned by an account, so the mode needs one. Unlike the static table
 * above, this is a function of the session rather than of the build: the same button is available to
 * a signed-in player and not to a guest, and the reason is shown either way.
 */
export function modeAvailable(mode: PlayMode, accountId: string | null): boolean {
  if (mode !== "friend") return MODE_AVAILABLE[mode];
  return Boolean(accountId);
}

/** Why "С другом" is unavailable, so the button can say something better than "no". */
export const FRIEND_MODE_HINT = "Совместная игра требует входа в аккаунт.";

type GameModalProps = {
  open: boolean;
  /** The signed-in account, or null for a guest. Saves are kept per account. */
  accountId: string | null;
  /**
   * A game invitation the player just pressed in the chat.
   *
   * It is handled once, on open: if it carries a server game's id the screen joins that game, and
   * otherwise it opens a local game of the same kind. `onInviteHandled` clears it so re-rendering
   * the screen does not join again.
   */
  pendingInvite?: GameInvitation | null;
  onInviteHandled?: () => void;
  onClose: () => void;
};

export default function GameModal({
  open,
  accountId,
  pendingInvite = null,
  onInviteHandled,
  onClose,
}: GameModalProps) {
  const sessions = useGameSessions(accountId);
  const bot = useChessBot();

  // The «Балда» word list is ~965 KB and lives in its own chunk, so opening the game list must not
  // download it. It is fetched when this screen opens, and the panel shows a retry if it fails.
  const [wordsState, setWordsState] = useState<"idle" | "loading" | "ready" | "failed">(
    dictionaryLoaded() ? "ready" : "idle"
  );
  const [wordsAttempt, setWordsAttempt] = useState(0);
  useEffect(() => {
    if (!open || dictionaryLoaded()) {
      setWordsState(dictionaryLoaded() ? "ready" : "idle");
      return;
    }
    let cancelled = false;
    setWordsState("loading");
    loadDictionary()
      .then(() => {
        if (!cancelled) setWordsState("ready");
      })
      .catch(() => {
        if (!cancelled) setWordsState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [open, wordsAttempt]);

  /*
   * A shared game opened from an invitation.
   *
   * The id in the invitation is the whole point: pressing the button has to put the player into the
   * game the other side is already sitting in. An invitation without an id - from a signed-out
   * sender, or an older client - falls back to a local game of the same kind, which is what the
   * note under the button promised for that case.
   */
  const [onlineGameId, setOnlineGameId] = useState<string | null>(null);
  const networked = useNetworkedGame(accountId, onlineGameId);

  useEffect(() => {
    if (!open || !pendingInvite) return;
    if (pendingInvite.gameId) {
      setOnlineGameId(pendingInvite.gameId);
      void networked.join(pendingInvite.gameId);
    } else {
      // No shared game to join: open a local one so the press still does something real.
      sessions.start(pendingInvite.kind, { mode: "local" });
    }
    // Consumed once. Without this the screen would try to join again on every re-render, and a
    // player who deliberately left the game would be pulled back into it.
    onInviteHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the invite is consumed on purpose, not tracked.
  }, [open, pendingInvite]);

  // Escape closes the screen, which is what every other overlay in the app does.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // A closed screen must not leave a search running: the answer would arrive after the player is
  // gone, and on a phone it would keep the processor busy for nothing.
  useEffect(() => {
    if (open) return;
    bot.cancel();
  }, [open, bot]);

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
                      onClick={() => kind && sessions.start(kind, { mode: "bot" })}
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

          <details className="game-rules">
            <summary>Правила шахмат в этой игре</summary>
            <ul>
              {CHESS_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </details>

          <p className="game-hint">
            Чтобы сыграть по сети, отправьте приглашение в чате и откройте его оттуда: партия живёт на
            сервере, и оба игрока видят один и тот же ход.
          </p>
        </section>
      </div>
    );
  }

  // A shared game takes over the screen. Checked before the local branch because the two never
  // coexist: a player is either in the game the server holds or in one on this device.
  if (onlineGameId && networked.state.kind !== "idle") {
    return (
      <NetworkedGamePanel
        state={networked.state}
        canAct={networked.canAct}
        onLeave={async () => {
          await networked.leave();
          setOnlineGameId(null);
          onClose();
        }}
        onRetry={() => void networked.refresh()}
        onClose={() => {
          setOnlineGameId(null);
          onClose();
        }}
      />
    );
  }

  const name = NAME_BY_KIND[current.kind];

  return (
    <div className="modal-backdrop game-backdrop" onClick={onClose}>
      <section
        className="game-modal game-modal-playing"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={name}
      >
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
          <ChessPanel
            session={current.state}
            viewer={sessions.viewerColor}
            active={open}
            bot={bot}
            onCommand={sessions.applyChess}
            onNewGame={() => {
              const viewer = sessions.viewerColor;
              sessions.restart(
                "chess",
                current.mode,
                current.difficulty,
                viewer === "b" ? "b" : "w"
              );
            }}
            onExit={onClose}
          />
        )}

        {current.kind === "cards" && (
          <CardTable
            state={current.state}
            // The seat at the screen is always «Вы». Showing the hand of whoever is on turn
            // would put the opponent's cards on screen - in a bot game the player would simply
            // read the bot's hand.
            playerId="Вы"
            hidden={current.mode === "bot" && currentPlayer(current.state) !== "Вы"}
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
            {wordsState !== "ready" ? (
              <p className="game-notice" role="alert">
                {wordsState === "failed"
                  ? "Словарь не загрузился. Без него партию начинать нельзя: любое слово считалось бы верным."
                  : "Загружаем словарь…"}
                {wordsState === "failed" && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setWordsAttempt((attempt) => attempt + 1)}
                  >
                    Повторить загрузку
                  </button>
                )}
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
                  <p className="game-hint">Уровень бота: {CHESS_DIFFICULTY[current.difficulty as "easy" | "normal"]}</p>
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

        {/* Chess draws its own outcome inside the panel, next to «Новая партия». */}
        {current.kind !== "chess" && resultText(current) && (
          <p className="game-result" role="status">
            {resultText(current)}
          </p>
        )}
      </section>
    </div>
  );
}

/** What the header says: the side to move, or the end of the game. */
function headline(current: OpenGame | null): string {
  if (!current) return "Мини-игры";
  if (resultOf(current)) return "Партия закончена";
  if (current.kind === "chess") return current.state.result ? "Партия закончена" : current.state.moves.length === 0 ? "Начало партии" : "Идёт партия";
  if (current.kind === "cards") return `Ход: ${currentPlayer(current.state)}`;
  return current.state.turnIndex === 0 ? "Ход первого игрока" : "Ход второго игрока";
}

function resultOf(current: OpenGame) {
  if (current.kind === "chess") return current.state.result;
  if (current.kind === "cards") return current.state.result;
  return current.state.result;
}

/** The result line for the two games that do not draw their own. */
function resultText(current: OpenGame | null): string {
  if (!current) return "";
  const result = resultOf(current);
  if (!result) return "";
  if (result.kind === "draw") return `Ничья: ${result.reason}.`;
  const winner = result.winnerId === "player-1" ? "первый игрок" : result.winnerId === "player-2" ? "второй игрок" : result.winnerId;
  return `Победил ${winner}: ${result.reason}.`;
}

export { KIND_BY_NAME, NAME_BY_KIND, MODE_AVAILABLE, MODE_LABEL, canPlay, COLOR_LABEL };
