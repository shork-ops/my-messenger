/**
 * The screen for a game held on the server.
 *
 * It is deliberately separate from the local game screens rather than a flag inside them. A local
 * game owns its state and applies every action immediately; a shared game owns nothing and every
 * action round-trips. Putting both in one component would mean every local move branching on
 * "am I networked", and the branch would eventually be wrong somewhere quiet.
 *
 * What each game can show is decided by what the server sends:
 *
 * - **chess** and **«Балда»**: the whole board. Nothing is hidden in either game, so the state
 *   arrives as-is and the panels draw it.
 * - **the card game**: only the viewer's own hand and a count for everybody else, because that is
 *   what `game_view_for` allows. The table therefore shows the viewer's cards and the opponents'
 *   counts - which is exactly what a player at a physical table can see.
 */

import { X } from "lucide-react";
import type { NetworkedGameState } from "../../games/core/useNetworkedGame";
import { handCounts, ownHand, NETWORK_TEXT, STATUS_TEXT } from "../../games/core/network";
import { gameName } from "../../games/core/invitation";

type NetworkedGamePanelProps = {
  state: NetworkedGameState;
  canAct: boolean;
  onLeave: () => void | Promise<void>;
  onRetry: () => void;
  onClose: () => void;
};

/** What to say instead of a board, for each reason the screen cannot show one. */
const ERROR_TEXT: Record<string, string> = {
  offline: NETWORK_TEXT.offline,
  "not-deployed": NETWORK_TEXT.notDeployed,
  refused: "Эта партия недоступна: вы не её участник.",
  expired: "Приглашение устарело.",
  full: "Мест за столом больше нет.",
  started: "Партия уже началась.",
};

export default function NetworkedGamePanel({ state, canAct, onLeave, onRetry, onClose }: NetworkedGamePanelProps) {
  if (state.kind === "idle") return null;

  if (state.kind === "loading") {
    return (
      <Shell title="Совместная партия" onClose={onClose}>
        <p className="game-hint">Загружаем партию…</p>
      </Shell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <Shell title="Совместная партия" onClose={onClose}>
        <p className="game-notice" role="alert">
          {ERROR_TEXT[state.error] ?? NETWORK_TEXT.refused}
        </p>
        <div className="game-picker-buttons">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Повторить
          </button>
        </div>
      </Shell>
    );
  }

  const { game, sending, note } = state;
  const seatsLine = game.players
    .map((player) => (player.seat === game.mySeat ? `${player.displayName} (вы)` : player.displayName))
    .join(" — ");

  return (
    <Shell title={`${gameName(game.kind)} · по сети`} onClose={onClose}>
      <p className="game-net-players" data-testid="net-players">
        {seatsLine}
      </p>

      {/* The revision is shown because it is the thing the two screens agree on. When it changes,
          the board changed; a player who sees it jump knows somebody moved. */}
      <p className="game-hint" data-testid="net-status">
        Ход {game.revision + 1} · {STATUS_TEXT[game.status] ?? game.status}
        {game.status === "playing" && (canAct ? " · ваш ход" : " · ждём соперника")}
      </p>

      {note && (
        <p className="game-notice" role="status">
          {note}
        </p>
      )}

      {game.status === "lobby" && (
        <p className="game-hint">
          {NETWORK_TEXT.waitingForOpponent} Приглашение отправлено в чат — как только соперник его
          откроет, партия начнётся.
        </p>
      )}

      {game.view.kind === "open" ? (
        <OpenBoard kind={game.kind} state={game.view.state} />
      ) : (
        <HiddenHandTable view={game.view} />
      )}

      {sending && <p className="game-hint">Отправляем ход…</p>}

      <div className="game-picker-buttons">
        <button type="button" className="btn btn-ghost" onClick={() => void onLeave()} disabled={sending}>
          Покинуть партию
        </button>
      </div>
    </Shell>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop game-backdrop" onClick={onClose}>
      <section
        className="game-modal game-modal-playing"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header className="game-modal-header">
          <div>
            <span className="game-modal-eyebrow">{title}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть игру">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

/**
 * The board for a game with no hidden information.
 *
 * It reports what the server holds rather than drawing a playable board, and says so. Drawing a
 * clickable board here and wiring every click by hand would duplicate the move rules that
 * `ChessPanel` and `BaldaBoard` already own - and a second copy of a rule is a second answer to
 * "is this legal", one of which will be wrong.
 */
function OpenBoard({ kind, state }: { kind: string; state: unknown }) {
  const record = (state ?? {}) as Record<string, unknown>;
  const moves = Array.isArray(record.moves) ? record.moves : [];
  const board = Array.isArray(record.board) ? (record.board as (string | null)[]) : null;

  if (kind === "balda" && board) {
    return (
      <div className="game-net-balda" data-testid="net-balda">
        {board.map((cell, index) => (
          <span key={index} className="game-net-cell">
            {cell ?? "·"}
          </span>
        ))}
      </div>
    );
  }

  return (
    <p className="game-hint" data-testid="net-moves">
      {moves.length === 0
        ? "Ходов пока нет."
        : `Ходов сделано: ${moves.length}.`}
    </p>
  );
}

/**
 * The card table, as far as the server allows it to be drawn.
 *
 * A player sees their own cards and how many each opponent holds. There is no deck and no lookup of
 * card faces, because the server does not send them - so the cards are shown by id, which is
 * honest about what is known rather than inventing a face.
 */
function HiddenHandTable({ view }: { view: Extract<NetworkedGameState, { kind: "ready" }>["game"]["view"] }) {
  if (view.kind !== "hands") return null;
  const mine = ownHand(view);
  const others = handCounts(view).filter((entry) => !mine.length || entry.playerId !== view.viewerId);

  return (
    <div className="game-net-cards" data-testid="net-cards">
      <p className="game-hint">Ваши карты: {mine.length ? mine.join(", ") : "нет"}</p>
      <p className="game-hint">
        У соперников: {others.map((entry) => `${entry.playerId} — ${entry.count}`).join(", ") || "—"}
      </p>
      <p className="game-hint">На столе: {view.discard.join(", ") || "пусто"}</p>
    </div>
  );
}
