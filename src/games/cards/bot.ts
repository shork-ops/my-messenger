/**
 * Card game bots.
 *
 * A bot here is not a chess engine with a search: cards are partly hidden, and a bot that
 * cheats by reading the deck is not a bot, it is a bug with a name. This one sees its own hand,
 * the top card and the colour in play - exactly what a human sees - and decides from that.
 *
 * The strategy is deliberately simple and readable, because a card bot that plays well by an
 * opaque heuristic cannot be explained when it plays strangely:
 *  1. Play a card that leaves the fewest cards, preferring action cards when the opponent is
 *     close to going out.
 *  2. Hold a wild until nothing else fits.
 *  3. Never play a +4 illegally when a +4-aware opponent could challenge - the bot does not
 *     know whether it will be challenged, so it plays as if it will be.
 */

import { makeRandom } from "../core/types";
import {
  applyCardAction,
  canPlay,
  currentPlayer,
  handOf,
  CARD_COLORS,
  type CardAction,
  type CardColor,
  type CardState,
} from "./deck";

export type CardDifficulty = "easy" | "normal";

/** The colour a player holds most of, or the colour in play when the hand is all wilds. */
export function bestColour(state: CardState, playerId: string): CardColor {
  const counts: Record<string, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const id of handOf(state, playerId)) {
    const color = state.cards[id].color;
    if (color) counts[color] += 1;
  }
  const best = CARD_COLORS.reduce((a, b) => (counts[b] > counts[a] ? b : a), CARD_COLORS[0]);
  return counts[best] > 0 ? best : state.activeColor;
}

/** How many cards the next player holds - the number that decides whether to attack. */
function opponentWeight(state: CardState): number {
  const next = state.order[(state.turnIndex + state.direction + state.order.length) % state.order.length];
  return handOf(state, next).length;
}

/**
 * Chooses an action for the bot.
 *
 * Returns null when the bot has nothing sensible to do, which the caller turns into a draw.
 */
export function chooseCardAction(
  state: CardState,
  difficulty: CardDifficulty = "normal",
  random: () => number = makeRandom(state.seed + state.discard.length)
): CardAction | null {
  if (state.result) return null;
  const playerId = currentPlayer(state);

  // A pending challenge must be answered before anything else, or the game waits forever.
  if (state.phase === "challenge" && state.pendingDraw4) {
    // The bot challenges only when it can reason the +4 was probably illegal: it knows its own
    // hand, so it knows whether a colour card was available to the accused. Without that
    // knowledge, challenging is a coin flip that costs four cards.
    const accusedHand = handOf(state, state.pendingDraw4.playerId);
    const hadColour = accusedHand.some((id) => state.cards[id].color === state.pendingDraw4!.colour);
    const sure = state.pendingDraw4.playerId === playerId ? false : hadColour;
    if (sure && difficulty === "normal") return { type: "challenge" };
    // Declining means drawing the penalty; the only way to decline is not to challenge and
    // let the turn pass, which the caller does by drawing.
    return null;
  }

  // Announcing "one card!" is a message, not a move. Returning only the announcement left the
  // bot stuck: it said "one card!" forever with the card still in its hand, and the game never
  // ended. Announce only once, then carry on to the actual play.
  if (
    state.phase === "one-card-window" &&
    handOf(state, playerId).length === 1 &&
    !state.events.some((event) => event === `${playerId}: одна карта!`)
  ) {
    return { type: "one-card", playerId };
  }

  const hand = handOf(state, playerId).map((id) => state.cards[id]);
  const playable = hand.filter((card) => canPlay(state, card));

  if (playable.length === 0) return { type: "draw" };

  // Easiest level plays a random legal card, but still a legal one.
  if (difficulty === "easy") {
    const card = playable[Math.floor(random() * playable.length)];
    const colour = card.color ?? bestColour(state, playerId);
    return { type: "play", cardId: card.id, chooseColor: colour };
  }

  const opponentCards = opponentWeight(state);
  const rank = (card: (typeof playable)[number]): number => {
    let score = 0;
    if (card.kind === "draw2") score += 40;
    if (card.kind === "wild4") score += 35;
    if (card.kind === "skip" || card.kind === "reverse") score += 30;
    // Attack harder when the opponent is close to winning.
    if (opponentCards <= 2 && (card.kind === "draw2" || card.kind === "wild4" || card.kind === "skip")) score += 25;
    // Keep wilds for when nothing else fits, unless it is the last move of the round.
    if (card.kind === "wild") score -= 20;
    if (card.kind === "wild4") score -= 5;
    // Prefer a colour the hand can keep following.
    if (card.color && card.color === bestColour(state, playerId)) score += 8;
    return score;
  };

  const sorted = playable.slice().sort((a, b) => rank(b) - rank(a));
  // A small random tie-break keeps two games with the same seed from being identical while
  // never letting an illegal or plainly worse card be chosen.
  const best = sorted[0];
  const tied = sorted.filter((card) => rank(card) === rank(best));
  const pick = tied[Math.floor(random() * tied.length)] ?? best;
  const colour = pick.color ?? bestColour(state, playerId);
  return { type: "play", cardId: pick.id, chooseColor: colour };
}

/**
 * Plays one full bot turn: announce, play, answer a challenge, or draw and pass.
 *
 * Returns the state after the turn. Written as a loop over `applyCardAction` rather than as
 * hand-edited state so the bot cannot produce something a human could not.
 */
export function playBotTurn(
  state: CardState,
  difficulty: CardDifficulty = "normal",
  random: () => number = makeRandom(state.seed + state.discard.length)
): CardState {
  const playerId = currentPlayer(state);
  if (state.result) return state;

  // Announce first, in the same turn: a bot that only announces would leave the turn with
  // itself and the card still in hand. The announcement is applied and the play below
  // continues from the announced state.
  let current = state;
  const announces = chooseCardAction(current, difficulty, random);
  if (announces?.type === "one-card") {
    const announced = applyCardAction(current, announces, random);
    if (announced.changed) current = announced.state;
  }

  const action = chooseCardAction(current, difficulty, random);
  if (!action) {
    // Declining a challenge: draw the penalty by passing the turn.
    return applyCardAction(state, { type: "pass" }, random).state;
  }
  // Drawing is not a complete turn: the turn only moves on when the drawn card is played or
  // the player passes. Returning the drawn state directly left the turn with the same player
  // forever - it drew, drew, drew, and the opponent never got a move.
  const result = action.type === "draw" ? { state: current, changed: false } : applyCardAction(current, action, random);
  if (result.changed) return result.state;

  const drawn = applyCardAction(current, { type: "draw" }, random);
  if (!drawn.changed) return current;
  if (drawn.state.result) return drawn.state;

  const now = drawn.state;
  const before = handOf(current, playerId);
  const after = handOf(now, playerId);
  const fresh = after.filter((id) => !before.includes(id));
  // The drawn card is the only one that may be played this turn, and only if it fits.
  const playable = fresh.map((id) => now.cards[id]).filter((card) => canPlay(now, card));
  if (playable.length > 0) {
    const card = playable[0];
    const play = applyCardAction(
      now,
      { type: "play", cardId: card.id, chooseColor: card.color ?? bestColour(now, playerId) },
      random
    );
    if (play.changed) return play.state;
  }
  // Nothing to play: hand the turn over rather than keeping it.
  const passed = applyCardAction(now, { type: "pass" }, random);
  return passed.changed ? passed.state : now;
}

/**
 * Whether the bot's hand is consistent with the rules: no card it does not hold.
 *
 * Used by the tests, and by the interface before trusting a bot move.
 */
export function botHandIsLegal(state: CardState, playerId: string): boolean {
  return handOf(state, playerId).every((id) => state.cards[id] !== undefined);
}
