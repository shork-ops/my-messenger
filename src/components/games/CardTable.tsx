/**
 * The card table.
 *
 * The card has to be readable without colour: the deck has four colours and a player who cannot
 * distinguish red from green must still know what they are holding. Every card carries a symbol
 * (● ▲ ■ ◆) and a text label next to its colour, so colour is decoration rather than
 * information.
 */

import { useMemo } from "react";
import {
  COLOR_LABEL,
  COLOR_SYMBOL,
  currentPlayer,
  describeCard,
  handOf,
  canPlay,
  type Card,
  type CardColor,
  type CardState,
} from "../../games/cards/deck";

type CardFaceProps = {
  card: Card;
  playable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
};

export function CardFace({ card, playable = false, selected = false, onSelect }: CardFaceProps) {
  const label = describeCard(card);
  const symbol = card.color ? COLOR_SYMBOL[card.color] : "";
  const colour = card.color ? COLOR_LABEL[card.color] : "";
  return (
    <button
      type="button"
      className={[
        "uno-card",
        card.color ? `uno-${card.color}` : "uno-wild",
        playable ? "uno-playable" : "",
        selected ? "uno-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${label}${card.color ? `, ${colour}` : ""}`}
      aria-pressed={selected}
      disabled={!onSelect}
      onClick={onSelect}
    >
      <span className="uno-card-symbol" aria-hidden="true">
        {symbol}
      </span>
      <span className="uno-card-label">{label}</span>
    </button>
  );
}

type CardTableProps = {
  state: CardState;
  playerId: string;
  /** True when this seat is a bot, so its hand is shown face down. */
  hidden: boolean;
  onPlay: (cardId: string) => void;
  onDraw: () => void;
  onPass: () => void;
  onChallenge: () => void;
  onOneCard: () => void;
  onChooseColour: (colour: CardColor) => void;
  disabled?: boolean;
};

export default function CardTable({
  state,
  playerId,
  hidden,
  onPlay,
  onDraw,
  onPass,
  onChallenge,
  onOneCard,
  onChooseColour,
  disabled = false,
}: CardTableProps) {
  const hand = handOf(state, playerId);
  const top = state.discard.length > 0 ? state.cards[state.discard[state.discard.length - 1]] : null;
  const active = currentPlayer(state);
  const isTurn = active === playerId && !disabled;
  const playable = useMemo(
    () => new Set(hand.filter((id) => canPlay(state, state.cards[id])).map((id) => id)),
    [hand, state]
  );

  const announced = state.events.some((event) => event === `${playerId}: одна карта!`);

  return (
    <div className="uno-table">
      <div className="uno-opponents">
        {state.hands
          .filter((other) => other.playerId !== playerId)
          .map((other) => (
            <div key={other.playerId} className="uno-opponent">
              <span>{other.playerId}</span>
              <span className="uno-opponent-count">{other.cards.length} карт</span>
            </div>
          ))}
      </div>

      <div className="uno-centre">
        <div className="uno-deck">
          <span className="uno-deck-count">{state.deck.length}</span>
          <span className="uno-deck-label">в колоде</span>
        </div>
        <div className="uno-pile">
          {top ? <CardFace card={top} /> : <span className="game-hint">Стопка пуста</span>}
        </div>
        <div className="uno-colour">
          <span className={`uno-colour-swatch uno-${state.activeColor}`} aria-hidden="true">
            {COLOR_SYMBOL[state.activeColor]}
          </span>
          <span>Цвет: {COLOR_LABEL[state.activeColor]}</span>
        </div>
      </div>

      {hidden ? (
        <p className="game-hint">Рука соперника скрыта.</p>
      ) : (
        <div className="uno-hand" aria-label="Ваши карты">
          {hand.map((id) => (
            <CardFace
              key={id}
              card={state.cards[id]}
              playable={playable.has(id)}
              onSelect={isTurn && playable.has(id) ? () => onPlay(id) : undefined}
            />
          ))}
        </div>
      )}

      <div className="uno-actions">
        {state.phase === "challenge" && isTurn && (
          <>
            <button type="button" className="btn btn-ghost" onClick={onChallenge}>
              Оспорить +4
            </button>
            <button type="button" className="btn btn-ghost" onClick={onPass}>
              Взять штраф
            </button>
          </>
        )}

        {state.phase === "one-card-window" && active === playerId && !announced && (
          <button type="button" className="btn btn-ghost" onClick={onOneCard}>
            Одна карта!
          </button>
        )}

        {state.phase === "choose-colour" && isTurn && (
          <div className="uno-colour-picker">
            <span>Выберите цвет:</span>
            {(Object.keys(COLOR_LABEL) as CardColor[]).map((colour) => (
              <button
                key={colour}
                type="button"
                className={`uno-colour-button uno-${colour}`}
                onClick={() => onChooseColour(colour)}
                aria-label={COLOR_LABEL[colour]}
              >
                <span aria-hidden="true">{COLOR_SYMBOL[colour]}</span> {COLOR_LABEL[colour]}
              </button>
            ))}
          </div>
        )}

        {isTurn && state.phase === "choose-colour" === false && playable.size === 0 && (
          <button type="button" className="btn btn-ghost" onClick={onDraw}>
            Взять карту
          </button>
        )}
      </div>
    </div>
  );
}
