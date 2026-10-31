/**
 * Card game bots.
 *
 * Two things matter and nothing else does: the bot plays only legal moves, and the bot can
 * actually win. A bot that plays legal but cannot finish a round makes the game unwinnable for
 * the player, which is worse than a bot that loses honestly.
 */

import { describe, expect, it } from "vitest";
import {
  applyCardAction,
  canPlay,
  countAllCards,
  currentPlayer,
  handOf,
  newCardState,
  type CardState,
} from "./deck";
import { bestColour, chooseCardAction, playBotTurn } from "./bot";
import { makeRandom } from "../core/types";

function fresh(players = ["alice", "bob"], seed = 5): CardState {
  return newCardState(players, seed);
}

describe("what the bot can see", () => {
  it("chooses the colour it holds most of", () => {
    const state = fresh();
    const colour = bestColour(state, "alice");
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 } as Record<string, number>;
    for (const id of handOf(state, "alice")) {
      const card = state.cards[id];
      if (card.color) counts[card.color] += 1;
    }
    if (Object.values(counts).some((n) => n > 0)) {
      expect(counts[colour]).toBe(Math.max(...Object.values(counts)));
    }
  });

  it("falls back to the colour in play when it holds no coloured cards", () => {
    const state = fresh();
    const allWild: CardState = {
      ...state,
      hands: state.hands.map((hand) =>
        hand.playerId === "alice"
          ? { ...hand, cards: Object.values(state.cards).filter((card) => card.kind === "wild").map((card) => card.id) }
          : hand
      ),
    };
    expect(bestColour(allWild, "alice")).toBe(state.activeColor);
  });
});

describe("the bot plays by the rules", () => {
  it("only chooses cards it actually holds and may play", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = fresh(["alice", "bob"], seed);
      const action = chooseCardAction(state, "normal", makeRandom(seed));
      expect(action).not.toBeNull();
      if (action?.type === "play") {
        const hand = handOf(state, currentPlayer(state));
        expect(hand).toContain(action.cardId);
        expect(canPlay(state, state.cards[action.cardId])).toBe(true);
      }
    }
  });

  it("never plays a card that is not in its hand", () => {
    // A bot that reasons about the deck instead of its hand is the classic cheating bug.
    for (let seed = 1; seed <= 20; seed += 1) {
      const state = fresh(["alice", "bob"], seed);
      const action = chooseCardAction(state, "easy", makeRandom(seed));
      if (action?.type === "play") {
        expect(handOf(state, currentPlayer(state))).toContain(action.cardId);
      }
    }
  });

  it("returns nothing once the game is over", () => {
    const state: CardState = { ...fresh(), result: { kind: "draw", reason: "тест" } };
    expect(chooseCardAction(state)).toBeNull();
  });

  it("announces its last card", () => {
    const state = fresh();
    const oneCard: CardState = {
      ...state,
      hands: state.hands.map((hand) =>
        hand.playerId === state.order[state.turnIndex] ? { ...hand, cards: [hand.cards[0]] } : hand
      ),
      phase: "one-card-window",
    };
    const action = chooseCardAction(oneCard);
    expect(action).toEqual({ type: "one-card", playerId: oneCard.order[oneCard.turnIndex] });
  });

  it("decides to challenge only when it can tell the +4 was illegal", () => {
    const state = fresh();
    // No pending +4: there is nothing to challenge.
    expect(chooseCardAction(state)?.type).not.toBe("challenge");

    const wild4 = Object.values(state.cards).find((card) => card.kind === "wild4")!;
    const redCard = Object.values(state.cards).find((card) => card.color === "red" && card.kind === "number")!;
    // Bob holds a red card and played +4 claiming red: Alice can see it and knows it is illegal.
    const cheating: CardState = {
      ...state,
      discard: [wild4.id],
      activeColor: "red",
      pendingDraw4: { playerId: "bob", colour: "red" },
      phase: "challenge",
      hands: state.hands.map((hand) =>
        hand.playerId === "bob" ? { ...hand, cards: [redCard.id, ...hand.cards] } : hand
      ),
    };
    expect(chooseCardAction(cheating, "normal")?.type).toBe("challenge");
  });
});

describe("the bot can win", () => {
  it("finishes a round against another bot", () => {
    // Two bots play a full round. If neither ever goes out, the game cannot be finished by a
    // bot opponent at all - the player would be stuck forever with no way to end a round.
    let state = fresh(["alice", "bob"], 21);
    let turns = 0;
    while (!state.result && turns < 400) {
      state = playBotTurn(state, "normal", makeRandom(turns + 7));
      turns += 1;
    }
    expect(state.result).not.toBeNull();
    expect(turns).toBeLessThan(400);
  });

  it("keeps the deck whole across a full bot game", () => {
    let state = fresh(["alice", "bob"], 33);
    let turns = 0;
    while (!state.result && turns < 400) {
      state = playBotTurn(state, "normal", makeRandom(turns + 11));
      const counts = countAllCards(state);
      expect(counts.total).toBe(108);
      expect(counts.unique).toBe(108);
      turns += 1;
    }
    expect(state.result).not.toBeNull();
  });

  it("can win against a player who only draws", () => {
    // The player never plays a card; the bot must still win on its own, by playing out its
    // hand. The player's hand grows without bound, so the bot is the only one who can finish.
    let state = fresh(["player", "bot"], 44);
    let steps = 0;
    while (!state.result && steps < 2000) {
      const actor = currentPlayer(state);
      if (actor === "bot") {
        state = playBotTurn(state, "normal", makeRandom(steps + 3));
      } else {
        // The player draws and passes, forever.
        const drawn = applyCardAction(state, { type: "draw" }, makeRandom(steps));
        state = applyCardAction(drawn.state, { type: "pass" }, makeRandom(steps)).state;
      }
      steps += 1;
    }
    expect(state.result?.kind).toBe("win");
    expect(state.result?.kind === "win" && state.result.winnerId).toBe("bot");
  }, 20000);
});
