/**
 * What the game screen shows.
 *
 * The card table has one property that matters more than the rest of its layout: it must never
 * show the hand of the player whose turn it is when that player is the bot. It did - the screen
 * passed the current player as the viewer, so in a bot game the player could read the bot's cards
 * whenever the bot moved.
 */

/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import CardTable from "./CardTable";
import { newCardState, currentPlayer, handOf } from "../../games/cards/deck";

function renderTable(mode: "bot" | "local") {
  const state = newCardState(["Вы", "Соперник"], 3);
  const turn = currentPlayer(state);
  const { container } = render(
    <CardTable
      state={state}
      // The seat at the screen is always the person using it, whatever the turn.
      playerId="Вы"
      hidden={mode === "bot" && turn !== "Вы"}
      onPlay={() => undefined}
      onDraw={() => undefined}
      onPass={() => undefined}
      onChallenge={() => undefined}
      onOneCard={() => undefined}
      onChooseColour={() => undefined}
    />
  );
  return { container, state, turn };
}

describe("the hand on screen", () => {
  it("never shows the opponent's cards in a bot game", () => {
    const { container, state, turn } = renderTable("bot");
    const shown = container.querySelectorAll(".uno-hand .uno-card");
    if (turn === "Вы") {
      // The player's own turn: their hand is visible and is exactly their hand.
      expect(shown).toHaveLength(handOf(state, "Вы").length);
    } else {
      // The bot's turn: nothing of the bot's may be readable.
      expect(shown).toHaveLength(0);
      expect(container.textContent).toContain("Рука соперника скрыта");
    }
  });

  it("shows both hands when two people share one device", () => {
    // On one device the turn is passed between two people at the same screen, so the table
    // shows the hand of whoever is to move rather than hiding it.
    const state = newCardState(["Вы", "Соперник"], 3);
    const { container } = render(
      <CardTable
        state={state}
        playerId={currentPlayer(state)}
        hidden={false}
        onPlay={() => undefined}
        onDraw={() => undefined}
        onPass={() => undefined}
        onChallenge={() => undefined}
        onOneCard={() => undefined}
        onChooseColour={() => undefined}
      />
    );
    expect(container.querySelectorAll(".uno-hand .uno-card").length).toBeGreaterThan(0);
  });
});
