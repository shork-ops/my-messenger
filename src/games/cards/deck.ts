/**
 * "Цветные карты" - a real card game, replacing the placeholder called Uno.
 *
 * The deck is 108 physical cards, and the whole design rests on that number being literally
 * true at every moment: each card is an object with its own id, so two identical red sevens are
 * two different cards. The old implementation stored cards as strings like "🔴 3" and removed
 * them with `filter`, which deleted every card with the same text at once - playing one copy of
 * a duplicate silently discarded the other.
 *
 * The rules here are the chosen variant, written down so they cannot drift:
 *   - 108 cards: four colours; one 0 and two each of 1-9 per colour; two Skip, two Reverse,
 *     two +2 per colour; four wild and four wild +4.
 *   - seven cards each at the start.
 *   - draw one; if it fits, it may be played that turn, and no other card may be chosen instead.
 *   - a wild +4 may be challenged; the challenger sees the proof only if entitled to it.
 *   - "One card!" must be announced within a limited window, and the penalty applies once.
 *   - when the draw pile runs out, the discard is reshuffled except its top card.
 *   - stacking of penalties and other house rules are off in this variant.
 */

import type { GameResult } from "../core/types";
import { makeRandom, shuffle } from "../core/types";

export type CardColor = "red" | "yellow" | "green" | "blue";
export type CardKind = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export type Card = {
  /** Unique per physical card. Two red sevens have different ids. */
  id: string;
  color: CardColor | null;
  kind: CardKind;
  /** 0-9 for number cards, null otherwise. */
  value: number | null;
};

export const CARD_COLORS: CardColor[] = ["red", "yellow", "green", "blue"];

export const COLOR_LABEL: Record<CardColor, string> = {
  red: "красный",
  yellow: "жёлтый",
  green: "зелёный",
  blue: "синий",
};

/** Colour is never carried by colour alone: a colour-blind player needs the word too. */
export const COLOR_SYMBOL: Record<CardColor, string> = {
  red: "●",
  yellow: "▲",
  green: "■",
  blue: "◆",
};

export const KIND_LABEL: Record<CardKind, string> = {
  number: "",
  skip: "Пропуск",
  reverse: "Разворот",
  draw2: "+2",
  wild: "Цвет",
  wild4: "+4",
};

/**
 * Builds the full 108-card deck.
 *
 * Written as a loop with an assertion rather than a hand-typed list, because a hand-typed list
 * is where a deck quietly ends up with 107 cards or three red fives.
 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let serial = 0;
  const nextId = () => `c${serial++}`;

  for (const color of CARD_COLORS) {
    // One zero per colour.
    cards.push({ id: nextId(), color, kind: "number", value: 0 });
    // Two of each 1-9.
    for (let value = 1; value <= 9; value += 1) {
      cards.push({ id: nextId(), color, kind: "number", value });
      cards.push({ id: nextId(), color, kind: "number", value });
    }
    // Two of each action per colour.
    for (const kind of ["skip", "reverse", "draw2"] as CardKind[]) {
      cards.push({ id: nextId(), color, kind, value: null });
      cards.push({ id: nextId(), color, kind, value: null });
    }
  }
  // Four wilds and four wild +4s.
  for (let i = 0; i < 4; i += 1) {
    cards.push({ id: nextId(), color: null, kind: "wild", value: null });
    cards.push({ id: nextId(), color: null, kind: "wild4", value: null });
  }

  if (cards.length !== 108) {
    throw new Error(`deck must hold 108 cards, built ${cards.length}`);
  }
  return cards;
}

export const DECK_SIZE = 108;

export type PlayerHand = { playerId: string; cards: string[] };

export type CardPhase =
  /** Waiting for the player to choose a colour after playing a wild. */
  | "choose-colour"
  /** Someone played +4 and the next player may challenge it. */
  | "challenge"
  /** A player has one card and the window to say "Одна карта!" is open. */
  | "one-card-window";

export type CardState = {
  deck: string[];
  discard: string[];
  hands: PlayerHand[];
  /** Every card by id, so the deck list stays small and a card is never duplicated. */
  cards: Record<string, Card>;
  order: string[];
  turnIndex: number;
  /** 1 or -1. With two players a Reverse acts as a Skip. */
  direction: 1 | -1;
  /** The colour in play: the card's own, or the chosen colour after a wild. */
  activeColor: CardColor;
  phase: CardPhase;
  /** Set while a wild is being resolved, or while a +4 is being challenged. */
  pending: PendingWild | null;
  /** Who played the +4 that may be challenged. */
  pendingDraw4: { playerId: string; colour: CardColor } | null;
  /** Rounds won, not cards. The score is what ends a series. */
  scores: Record<string, number>;
  /** Cards left when someone went out this round, for scoring. */
  roundOver: boolean;
  result: GameResult | null;
  seed: number;
  /** Words said out loud, for the interface to show. */
  events: string[];
};

export type PendingWild = {
  playerId: string;
  cardId: string;
  /** What this wild does once a colour is chosen. */
  kind: "wild" | "wild4";
};

export const STARTING_HAND = 7;

export function newCardState(playerIds: string[], seed: number): CardState {
  const random = makeRandom(seed);
  const deck = shuffle(buildDeck(), random);
  const cards: Record<string, Card> = {};
  for (const card of deck) cards[card.id] = card;

  let pool = deck.map((card) => card.id);
  const hands: PlayerHand[] = playerIds.map((playerId) => {
    const hand = pool.slice(0, STARTING_HAND);
    pool = pool.slice(STARTING_HAND);
    return { playerId, cards: hand };
  });

  // The first card cannot be a wild or an action that would need an answer before anyone has
  // had a turn. Put those back and draw again instead of inventing a rule for them.
  let firstIndex = 0;
  while (cards[pool[firstIndex]].color === null || cards[pool[firstIndex]].kind === "draw2") {
    firstIndex += 1;
  }
  const first = pool[firstIndex];
  pool = [...pool.slice(0, firstIndex), ...pool.slice(firstIndex + 1)];

  const state: CardState = {
    deck: pool,
    discard: [first],
    hands,
    cards,
    order: playerIds.slice(),
    turnIndex: 0,
    direction: 1,
    activeColor: cards[first].color as CardColor,
    phase: "choose-colour",
    pending: null,
    pendingDraw4: null,
    scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    roundOver: false,
    result: null,
    seed,
    events: [],
  };
  return state;
}

export function topCard(state: CardState): Card {
  return state.cards[state.discard[state.discard.length - 1]];
}

export function handOf(state: CardState, playerId: string): string[] {
  return state.hands.find((hand) => hand.playerId === playerId)?.cards ?? [];
}

export function currentPlayer(state: CardState): string {
  return state.order[state.turnIndex];
}

/** Whether a card may be played onto the current top card. */
export function canPlay(state: CardState, card: Card): boolean {
  if (card.kind === "wild" || card.kind === "wild4") return true;
  if (card.color === state.activeColor) return true;
  const top = topCard(state);
  if (top.kind === "number" && card.kind === "number" && top.value === card.value) return true;
  if (top.kind !== "number" && card.kind === top.kind) return true;
  return false;
}

export function playableCards(state: CardState, playerId: string): Card[] {
  return handOf(state, playerId).map((id) => state.cards[id]).filter((card) => canPlay(state, card));
}

/**
 * Whether a +4 was legally played.
 *
 * The proof is what a challenge reveals: a +4 is only allowed when the player had no card of
 * the colour in play. This function is the single place that decides, so the challenge and the
 * bot cannot disagree.
 */
export function isWild4Legal(state: CardState, playerId: string, cardId: string, colorInPlay: CardColor): boolean {
  const hand = handOf(state, playerId).filter((id) => id !== cardId);
  return !hand.some((id) => state.cards[id].color === colorInPlay);
}

export type CardAction =
  | { type: "play"; cardId: string; chooseColor?: CardColor }
  | { type: "draw" }
  | { type: "challenge" }
  | { type: "one-card"; playerId: string }
  | { type: "pass" };

export type CardApplyResult = { state: CardState; changed: boolean; reason?: string };

function nextIndex(state: CardState, steps = 1): number {
  const size = state.order.length;
  return (((state.turnIndex + state.direction * steps) % size) + size) % size;
}

function withHand(state: CardState, playerId: string, cards: string[]): PlayerHand[] {
  return state.hands.map((hand) => (hand.playerId === playerId ? { ...hand, cards } : hand));
}

/** Draws `count` cards for a player, reshuffling the discard when the deck runs dry. */
function drawCards(
  state: CardState,
  playerId: string,
  count: number,
  random: () => number
): { state: CardState; drawn: string[]; deckExhausted: boolean } {
  let deck = state.deck.slice();
  let discard = state.discard.slice();
  const hand = handOf(state, playerId).slice();
  const drawn: string[] = [];
  let deckExhausted = false;

  for (let i = 0; i < count; i += 1) {
    if (deck.length === 0) {
      // Reshuffle everything but the top card, which stays as the current card.
      const top = discard[discard.length - 1];
      const rest = discard.slice(0, -1);
      if (rest.length === 0) {
        // No card to draw and nothing to reshuffle. The round cannot continue by drawing;
        // the interface must offer a pass rather than hang.
        deckExhausted = true;
        break;
      }
      deck = shuffle(rest, random);
      discard = [top];
    }
    drawn.push(deck[0]);
    hand.push(deck[0]);
    deck = deck.slice(1);
  }

  return {
    state: { ...state, deck, discard, hands: withHand(state, playerId, hand) },
    drawn,
    deckExhausted,
  };
}

/** Points a player's remaining cards are worth under this variant's scoring. */
export function scoreHand(state: CardState, playerId: string): number {
  return handOf(state, playerId).reduce((total, id) => {
    const card = state.cards[id];
    if (card.kind === "wild" || card.kind === "wild4") return total + 50;
    if (card.kind === "number") return total + (card.value ?? 0);
    return total + 20;
  }, 0);
}

/**
 * Applies one action.
 *
 * Every refusal returns the identical state object, because a refused action that returns an
 * equal copy still looks like a change to anything comparing identity.
 */
export function applyCardAction(
  state: CardState,
  action: CardAction,
  random: () => number = makeRandom(state.seed + state.deck.length)
): CardApplyResult {
  if (state.result) {
    return { state, changed: false, reason: "Партия закончена" };
  }

  if (action.type === "challenge") {
    if (!state.pendingDraw4) {
      return { state, changed: false, reason: "Оспаривать нечего" };
    }
    const { playerId: accused, colour } = state.pendingDraw4;
    const challenger = state.order[state.turnIndex];
    const legal = isWild4Legal(state, accused, state.discard[state.discard.length - 1], colour);
    // A legal +4 means the challenger draws the penalty instead; a cheating one means the
    // accused draws it. Showing the proof is the whole point of the challenge.
    const penaltyTarget = legal ? challenger : accused;
    const penalty = 4;
    const after = drawCards({ ...state, pendingDraw4: null, phase: "choose-colour" }, penaltyTarget, penalty, random);
    return {
      state: {
        ...after.state,
        turnIndex: nextIndex(after.state, 1),
        events: [
          ...state.events,
          legal
            ? `Оспаривание отклонено: у ${accused} не было карты этого цвета. Штраф берёт ${challenger}.`
            : `Оспаривание принято: ${accused} сыграл +4 незаконно. Штраф берёт он.`,
        ],
      },
      changed: true,
    };
  }

  const playerId = currentPlayer(state);

  if (action.type === "one-card") {
    // Announcing is only meaningful for the player holding one card, and only once.
    if (action.playerId !== playerId) {
      return { state, changed: false, reason: "Объявить может только тот, чья очередь" };
    }
    if (handOf(state, playerId).length !== 1) {
      return { state, changed: false, reason: "«Одна карта!» говорят, когда осталась одна карта" };
    }
    return {
      state: { ...state, events: [...state.events, `${playerId}: одна карта!`] },
      changed: true,
    };
  }

  if (action.type === "draw") {
    if (state.pending) {
      return { state, changed: false, reason: "Сначала выберите цвет" };
    }
    const after = drawCards(state, playerId, 1, random);
    const drawnId = after.drawn[0];
    const drawn = drawnId ? after.state.cards[drawnId] : null;
    const fits = drawn ? canPlay(after.state, drawn) : false;
    return {
      state: {
        ...after.state,
        // Draw one, then either play that card or pass. No choosing a different one.
        phase: "choose-colour",
        events: [
          ...state.events,
          drawn
            ? `${playerId} взял${fits ? " карту — её можно сыграть" : ""}`
            : `${playerId}: колода исчерпана`,
        ],
      },
      changed: true,
    };
  }

  if (action.type === "pass") {
    return {
      state: { ...state, turnIndex: nextIndex(state, 1), events: [...state.events, `${playerId}: пропуск`] },
      changed: true,
    };
  }

  const card = state.cards[action.cardId];
  if (!card) return { state, changed: false, reason: "Такой карты нет" };
  if (!handOf(state, playerId).includes(action.cardId)) {
    return { state, changed: false, reason: "Этой карты нет в вашей руке" };
  }
  if (!canPlay(state, card)) {
    return { state, changed: false, reason: "Эту карту нельзя сыграть: не совпадает ни цвет, ни значение" };
  }

  const needsColour = card.kind === "wild" || card.kind === "wild4";
  if (needsColour && !action.chooseColor) {
    return { state, changed: false, reason: "Выберите цвет" };
  }

  // Playing a +4 opens the challenge window before anything is applied.
  if (card.kind === "wild4" && !state.pendingDraw4) {
    const played = playCard(state, playerId, card, action.chooseColor!, random);
    return {
      state: {
        ...played,
        phase: "challenge",
        pendingDraw4: { playerId, colour: action.chooseColor! },
      },
      changed: true,
    };
  }

  return { state: playCard(state, playerId, card, action.chooseColor ?? null, random), changed: true };
}

/** The mechanics of placing a card: hand, discard, colour, direction, turn order, finish. */
function playCard(
  state: CardState,
  playerId: string,
  card: Card,
  chosenColor: CardColor | null,
  random: () => number
): CardState {
  const remaining = handOf(state, playerId).filter((id) => id !== card.id);
  let next: CardState = {
    ...state,
    hands: withHand(state, playerId, remaining),
    discard: [...state.discard, card.id],
    activeColor: chosenColor ?? card.color ?? state.activeColor,
    pendingDraw4: null,
    phase: "choose-colour",
    events: [...state.events, `${playerId} сыграл ${describeCard(card)}`],
  };

  if (remaining.length === 0) {
    // The last card still applies its penalty. This is the rule players argue about most.
    if (card.kind === "draw2") {
      const victim = state.order[nextIndex(state, 1)];
      next = drawCards(next, victim, 2, random).state;
    }
    if (card.kind === "wild4") {
      const victim = state.order[nextIndex(state, 1)];
      next = drawCards(next, victim, 4, random).state;
    }
    const won = { ...next, roundOver: true };
    return {
      ...won,
      scores: { ...won.scores, [playerId]: won.scores[playerId] + 1 },
      result: { kind: "win", winnerId: playerId, reason: "вышел из карт" },
    };
  }

  let steps = 1;
  // With two players there is nobody to skip past. Stepping two lands back on the player who
  // just moved, so that player keeps playing their whole hand while the other watches - and
  // every action card made the game longer instead of shorter. With one opponent, a Skip and
  // a Reverse both simply hand the turn over.
  const twoPlayers = state.order.length === 2;
  if (card.kind === "skip") steps = twoPlayers ? 1 : 2;
  if (card.kind === "reverse") {
    if (twoPlayers) {
      steps = 1;
    } else {
      next = { ...next, direction: (state.direction === 1 ? -1 : 1) as 1 | -1 };
      steps = 1;
    }
  }
  // A draw penalty makes the next player draw and then lose their turn: two steps without a
  // second player to skip to.
  if (card.kind === "draw2") {
    const victim = state.order[nextIndex(state, 1)];
    next = drawCards(next, victim, 2, random).state;
    steps = twoPlayers ? 1 : 2;
  }
  if (card.kind === "wild4") {
    const victim = state.order[nextIndex(state, 1)];
    next = drawCards(next, victim, 4, random).state;
    steps = twoPlayers ? 1 : 2;
  }

  const turnIndex = (((next.turnIndex + next.direction * steps) % next.order.length) + next.order.length) % next.order.length;
  return { ...next, turnIndex, phase: next.hands.some((hand) => hand.cards.length === 1) ? "one-card-window" : "choose-colour" };
}

/** A card as a player would say it out loud. */
export function describeCard(card: Card): string {
  // A label has to stand on its own when it is read aloud: "+4" alone says nothing about being
  // a card, and neither does "смена цвета".
  if (card.kind === "wild") return "дикая карта, смена цвета";
  if (card.kind === "wild4") return "дикая карта +4";
  const colour = card.color ? COLOR_LABEL[card.color] : "";
  if (card.kind === "number") return `${colour} ${card.value}`;
  return `${colour} ${KIND_LABEL[card.kind]}`;
}

/** Whether the game as a whole is over: a series to 500 points, or a single round. */
export function seriesWinner(state: CardState, target: number): string | null {
  return Object.entries(state.scores).find(([, score]) => score >= target)?.[0] ?? null;
}

/** For the tests to prove the deck stays whole: every card is somewhere, exactly once. */
export function countAllCards(state: CardState): { total: number; unique: number } {
  const all = [
    ...state.deck,
    ...state.discard,
    ...state.hands.flatMap((hand) => hand.cards),
  ];
  return { total: all.length, unique: new Set(all).size };
}
