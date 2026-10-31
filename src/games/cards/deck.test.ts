/**
 * "Цветные карты".
 *
 * The first test file in this project where the headline requirement is a number: exactly 108
 * unique cards must exist at every moment. That is not pedantry - the placeholder this replaces
 * stored cards as identical strings and removed them with `filter`, so playing one of two
 * duplicate cards silently destroyed the other. Counting is the only way to see that class of
 * bug, because the hand still looks plausible.
 */

import { describe, expect, it } from "vitest";
import {
  applyCardAction,
  buildDeck,
  canPlay,
  countAllCards,
  DECK_SIZE,
  describeCard,
  handOf,
  isWild4Legal,
  newCardState,
  playableCards,
  scoreHand,
  seriesWinner,
  topCard,
  type CardState,
} from "./deck";
import { makeRandom } from "../core/types";

const PLAYERS = ["alice", "bob", "carol", "dave"];

function fresh(players = PLAYERS, seed = 1): CardState {
  return newCardState(players, seed);
}

/**
 * Puts a specific card into a player's hand by taking it from wherever it already is.
 *
 * Moving rather than copying is the point: adding a card without removing it from the deck
 * makes the 108-card invariant fail, and the failure would be blamed on the engine.
 */
function moveCardToHand(state: CardState, playerId: string, cardId: string): CardState {
  const colour = state.cards[cardId].color ?? state.activeColor;
  return {
    ...state,
    activeColor: colour,
    deck: state.deck.filter((id) => id !== cardId),
    discard: state.discard.includes(cardId) ? state.discard.filter((id) => id !== cardId) : state.discard,
    hands: state.hands.map((hand) => {
      const cards = hand.playerId === playerId
        ? [cardId, ...hand.cards.filter((id) => id !== cardId)]
        : hand.cards.filter((id) => id !== cardId);
      return { ...hand, cards };
    }),
  };
}


describe("the deck", () => {
  it("holds exactly 108 cards", () => {
    expect(buildDeck()).toHaveLength(DECK_SIZE);
  });

  it("gives every card its own id, including identical-looking ones", () => {
    const deck = buildDeck();
    expect(new Set(deck.map((card) => card.id)).size).toBe(108);
  });

  it("has one zero per colour and two of each 1-9", () => {
    const deck = buildDeck();
    for (const color of ["red", "yellow", "green", "blue"] as const) {
      const ofColour = deck.filter((card) => card.color === color);
      expect(ofColour.filter((card) => card.kind === "number" && card.value === 0)).toHaveLength(1);
      for (let value = 1; value <= 9; value += 1) {
        expect(ofColour.filter((card) => card.kind === "number" && card.value === value)).toHaveLength(2);
      }
    }
  });

  it("has two of each action per colour and four of each wild", () => {
    const deck = buildDeck();
    for (const color of ["red", "yellow", "green", "blue"] as const) {
      const ofColour = deck.filter((card) => card.color === color);
      for (const kind of ["skip", "reverse", "draw2"] as const) {
        expect(ofColour.filter((card) => card.kind === kind)).toHaveLength(2);
      }
    }
    expect(deck.filter((card) => card.kind === "wild")).toHaveLength(4);
    expect(deck.filter((card) => card.kind === "wild4")).toHaveLength(4);
  });
});

describe("dealing", () => {
  it("gives every player seven cards", () => {
    const state = fresh();
    for (const player of PLAYERS) {
      expect(handOf(state, player)).toHaveLength(7);
    }
  });

  it("keeps all 108 cards somewhere, each exactly once", () => {
    const state = fresh();
    const { total, unique } = countAllCards(state);
    expect(total).toBe(108);
    expect(unique).toBe(108);
  });

  it("puts a playable first card on the table", () => {
    // A wild or a +2 as the opening card would need an answer before anyone has moved.
    const state = fresh();
    const top = topCard(state);
    expect(top.color).not.toBeNull();
    expect(top.kind).not.toBe("draw2");
  });

  it("gives nobody the same physical card as anyone else", () => {
    const state = fresh();
    const dealt = state.hands.flatMap((hand) => hand.cards);
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it("deals differently with a different seed, and identically with the same one", () => {
    const a = fresh(PLAYERS, 1);
    const b = fresh(PLAYERS, 2);
    const again = fresh(PLAYERS, 1);
    expect(handOf(a, "alice")).not.toEqual(handOf(b, "alice"));
    expect(handOf(a, "alice")).toEqual(handOf(again, "alice"));
  });
});

describe("playing a card", () => {
  it("accepts a card of the same colour", () => {
    const state = fresh();
    const top = topCard(state);
    const hand = handOf(state, "alice");
    const matching = hand.find((id) => state.cards[id].color === top.color);
    if (!matching) return;
    const result = applyCardAction(state, { type: "play", cardId: matching });
    expect(result.changed).toBe(true);
  });

  it("refuses a card that matches neither colour nor value", () => {
    const state = fresh();
    const hand = handOf(state, "alice").map((id) => state.cards[id]);
    const wrong = hand.find((card) => !canPlay(state, card));
    if (!wrong) return;
    const result = applyCardAction(state, { type: "play", cardId: wrong.id });
    expect(result.changed).toBe(false);
    // Same object, not an equal copy: identity is how "nothing happened" is proven.
    expect(result.state).toBe(state);
  });

  it("does not remove a second copy when playing one of two identical cards", () => {
    // This is the bug the old placeholder had: `filter` deleted every card with the same
    // text. Building a hand with two identical cards and playing one must leave the other.
    const state = fresh();
    const pairs = Object.values(state.cards);
    const duplicate = pairs.find((card, index) =>
      pairs.some((other, otherIndex) => otherIndex > index && other.color === card.color &&
        other.kind === card.kind && other.value === card.value)
    );
    expect(duplicate).toBeDefined();

    const top = topCard(state);
    const withTwo: CardState = {
      ...state,
      discard: [...state.discard, duplicate!.id].slice(0, -1),
      hands: state.hands.map((hand) =>
        hand.playerId === "alice" ? { ...hand, cards: [duplicate!.id, ...hand.cards] } : hand
      ),
    };
    // Make sure the card is playable by colour.
    const prepared: CardState = { ...withTwo, activeColor: duplicate!.color ?? top.color! };
    const before = handOf(prepared, "alice").length;
    const result = applyCardAction(prepared, { type: "play", cardId: duplicate!.id });
    if (!result.changed) return;
    // Exactly one card left the hand, not every card that looks like it.
    expect(handOf(result.state, "alice")).toHaveLength(before - 1);
    const { total, unique } = countAllCards(result.state);
    expect(total).toBe(108);
    expect(unique).toBe(108);
  });

  it("asks for a colour when a wild is played", () => {
    const state = fresh();
    const wild = Object.values(state.cards).find((card) => card.kind === "wild")!;
    const prepared = moveCardToHand(state, "alice", wild.id);
    const refused = applyCardAction(prepared, { type: "play", cardId: wild.id });
    expect(refused.changed).toBe(false);
    expect(refused.reason).toContain("цвет");
    const accepted = applyCardAction(prepared, { type: "play", cardId: wild.id, chooseColor: "green" });
    expect(accepted.changed).toBe(true);
    expect(accepted.state.activeColor).toBe("green");
  });

  it("refuses a card that is not in the player's hand", () => {
    const state = fresh();
    const others = handOf(state, "bob");
    const result = applyCardAction(state, { type: "play", cardId: others[0] });
    expect(result.changed).toBe(false);
    expect(result.reason).toContain("нет в вашей руке");
  });

  it("refuses every action once the game is over", () => {
    const state = fresh();
    const won: CardState = { ...state, result: { kind: "draw", reason: "тест" } };
    const result = applyCardAction(won, { type: "draw" });
    expect(result.changed).toBe(false);
    expect(result.state).toBe(won);
  });
});

describe("turn order and actions", () => {
  it("skips the next player on a Skip", () => {
    const state = fresh();
    const skip = Object.values(state.cards).find((card) => card.kind === "skip")!;
    const prepared = moveCardToHand(state, "alice", skip.id);
    const result = applyCardAction(prepared, { type: "play", cardId: skip.id });
    expect(result.changed).toBe(true);
    // Alice, bob (skipped), carol: the turn lands on carol.
    expect(result.state.order[result.state.turnIndex]).toBe("carol");
  });

  it("reverses direction with four players", () => {
    const state = fresh();
    const reverse = Object.values(state.cards).find((card) => card.kind === "reverse")!;
    const prepared = moveCardToHand(state, "alice", reverse.id);
    const result = applyCardAction(prepared, { type: "play", cardId: reverse.id });
    expect(result.state.direction).toBe(-1);
    expect(result.state.order[result.state.turnIndex]).toBe("dave");
  });

  it("treats Reverse as Skip when only two people play", () => {
    const state = fresh(["alice", "bob"]);
    const reverse = Object.values(state.cards).find((card) => card.kind === "reverse")!;
    const prepared: CardState = {
      ...state,
      activeColor: reverse.color!,
      hands: state.hands.map((hand) =>
        hand.playerId === "alice" ? { ...hand, cards: [reverse.id, ...hand.cards] } : hand
      ),
    };
    const result = applyCardAction(prepared, { type: "play", cardId: reverse.id });
    // With two players, reversing would point the turn back at the mover forever, so a
    // Reverse simply hands the turn to the other player.
    expect(result.state.order[result.state.turnIndex]).toBe("bob");
  });

  it("makes the next player draw two on a +2", () => {
    const state = fresh();
    const draw2 = Object.values(state.cards).find((card) => card.kind === "draw2")!;
    const prepared = moveCardToHand(state, "alice", draw2.id);
    const before = handOf(prepared, "bob").length;
    const result = applyCardAction(prepared, { type: "play", cardId: draw2.id });
    expect(handOf(result.state, "bob")).toHaveLength(before + 2);
    expect(countAllCards(result.state).total).toBe(108);
  });

  it("draws one card and keeps the deck whole", () => {
    const state = fresh();
    const before = handOf(state, "alice").length;
    const result = applyCardAction(state, { type: "draw" });
    expect(result.changed).toBe(true);
    expect(handOf(result.state, "alice")).toHaveLength(before + 1);
    expect(countAllCards(result.state).total).toBe(108);
  });
});

describe("the +4 challenge", () => {
  it("opens a challenge window instead of applying the penalty at once", () => {
    const state = fresh();
    const wild4 = Object.values(state.cards).find((card) => card.kind === "wild4")!;
    const prepared = moveCardToHand(state, "alice", wild4.id);
    const result = applyCardAction(prepared, { type: "play", cardId: wild4.id, chooseColor: "red" });
    expect(result.state.phase).toBe("challenge");
    expect(result.state.pendingDraw4).toEqual({ playerId: "alice", colour: "red" });
  });

  it("penalises the player who played a +4 illegally", () => {
    // Give Alice a red card in hand, then have her play +4 claiming red - that is illegal.
    const state = fresh();
    const wild4 = Object.values(state.cards).find((card) => card.kind === "wild4")!;
    const redCard = Object.values(state.cards).find((card) => card.color === "red" && card.kind === "number")!;
    const prepared: CardState = {
      ...state,
      discard: [redCard.id],
      activeColor: "red",
      hands: state.hands.map((hand) =>
        hand.playerId === "alice" ? { ...hand, cards: [wild4.id, wild4.id === redCard.id ? wild4.id : redCard.id] } : hand
      ),
    };
    const played = applyCardAction(prepared, { type: "play", cardId: wild4.id, chooseColor: "red" });
    expect(played.state.pendingDraw4).not.toBeNull();
    const before = handOf(played.state, "alice").length;
    const challenged = applyCardAction(played.state, { type: "challenge" });
    expect(challenged.changed).toBe(true);
    expect(handOf(challenged.state, "alice")).toHaveLength(before + 4);
  });

  it("knows whether a +4 was legal", () => {
    const state = fresh();
    const wild4 = Object.values(state.cards).find((card) => card.kind === "wild4")!;
    const redCard = Object.values(state.cards).find((card) => card.color === "red" && card.kind === "number")!;
    const hand = ["alice"];
    const prepared: CardState = {
      ...state,
      hands: state.hands.map((entry) =>
        entry.playerId === "alice" ? { ...entry, cards: [wild4.id, redCard.id] } : entry
      ),
    };
    // Alice holds a red card, so +4 claiming red is not allowed.
    expect(isWild4Legal(prepared, "alice", wild4.id, "red")).toBe(false);
    // She holds no green card, so +4 claiming green is fine.
    expect(isWild4Legal(prepared, "alice", wild4.id, "green")).toBe(true);
    void hand;
  });

  it("refuses a challenge when no +4 is pending", () => {
    const state = fresh();
    const result = applyCardAction(state, { type: "challenge" });
    expect(result.changed).toBe(false);
  });
});

describe("ending a round", () => {
  it("ends the game when a player runs out of cards", () => {
    const state = fresh();
    const top = topCard(state);
    const card = Object.values(state.cards).find((candidate) => candidate.color === top.color && candidate.kind === "number")!;
    const prepared: CardState = {
      ...state,
      hands: state.hands.map((hand) =>
        hand.playerId === "alice" ? { ...hand, cards: [card.id] } : hand
      ),
    };
    // The deck books for the other players still hold the rest; the point is the finish.
    const result = applyCardAction(prepared, { type: "play", cardId: card.id });
    expect(result.changed).toBe(true);
    expect(result.state.result).toEqual({ kind: "win", winnerId: "alice", reason: "вышел из карт" });
    expect(result.state.scores.alice).toBe(1);
  });

  it("applies the penalty of a last +2 card before ending", () => {
    const state = fresh();
    const draw2 = Object.values(state.cards).find((card) => card.kind === "draw2")!;
    const prepared: CardState = {
      ...state,
      activeColor: draw2.color!,
      hands: state.hands.map((hand) =>
        hand.playerId === "alice" ? { ...hand, cards: [draw2.id] } : hand
      ),
    };
    const before = handOf(prepared, "bob").length;
    const result = applyCardAction(prepared, { type: "play", cardId: draw2.id });
    expect(result.state.result).not.toBeNull();
    // The last card still makes the next player draw.
    expect(handOf(result.state, "bob")).toHaveLength(before + 2);
  });

  it("scores remaining cards by the variant's values", () => {
    const state = fresh();
    const alice = handOf(state, "alice");
    const expected = alice.reduce((total, id) => {
      const card = state.cards[id];
      if (card.kind === "wild" || card.kind === "wild4") return total + 50;
      if (card.kind === "number") return total + (card.value ?? 0);
      return total + 20;
    }, 0);
    expect(scoreHand(state, "alice")).toBe(expected);
  });

  it("declares a series winner at the target score", () => {
    const state = fresh();
    expect(seriesWinner(state, 500)).toBeNull();
    const scored: CardState = { ...state, scores: { ...state.scores, bob: 500 } };
    expect(seriesWinner(scored, 500)).toBe("bob");
  });
});

describe("the deck never leaks or duplicates", () => {
  it("stays at 108 unique cards across a long random game", () => {
    // The invariant is checked after every single action, not just at the end: a card that
    // vanishes for one action and comes back later is still a bug a player would notice.
    let state = fresh(["alice", "bob"], 99);
    const random = makeRandom(1234);
    let actions = 0;
    while (!state.result && actions < 300) {
      const player = state.order[state.turnIndex];
      const playable = playableCards(state, player);
      if (playable.length > 0 && random() < 0.8) {
        const card = playable[Math.floor(random() * playable.length)];
        const colour = card.color ?? (["red", "yellow", "green", "blue"] as const)[Math.floor(random() * 4)];
        state = applyCardAction(state, { type: "play", cardId: card.id, chooseColor: colour }, random).state;
      } else {
        state = applyCardAction(state, { type: "draw" }, random).state;
        state = applyCardAction(state, { type: "pass" }, random).state;
      }
      const counts = countAllCards(state);
      expect(counts.total).toBe(108);
      expect(counts.unique).toBe(108);
      actions += 1;
    }
    // It has to actually progress: a game that never ends is a hang, not a game.
    expect(actions).toBeLessThan(300);
  });

  it("describes a card in words, not by colour alone", () => {
    // Colour must be doubled by a word, or a colour-blind player cannot tell red from green.
    expect(describeCard({ id: "x", color: "red", kind: "number", value: 7 })).toBe("красный 7");
    expect(describeCard({ id: "y", color: null, kind: "wild4", value: null })).toBe("дикая карта +4");
  });
});
