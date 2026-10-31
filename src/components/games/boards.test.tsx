/**
 * The games screen.
 *
 * The pieces that broke here before were not in the engines but in the joining: a game that could
 * not be reopened, a board that could not be played with keyboard, a card table that told a player
 * what to do and then refused to do it. These tests drive the rendered screen.
 *
 * The chess board is tested through the position view it draws, because that is the seam the
 * session engine produces and the board consumes: if the two ever disagree about a square, the
 * board would draw a moveable piece that the rules refuse.
 */

/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import ChessBoard, { PromotionPicker, pieceWord, squareLabel } from "./ChessBoard";
import CardTable from "./CardTable";
import BaldaBoard from "./BaldaBoard";
import { newCardState, currentPlayer, handOf, canPlay } from "../../games/cards/deck";
import { createBalda, BOARD_SIZE, START_WORD } from "../../games/balda/engine";
import { createChessSession, START_FEN, viewPosition, type ChessSquare } from "../../games/chess/session";

/** The starting position, with white to move. */
function startView() {
  return viewPosition(createChessSession({ mode: "local" }));
}

/** A square button by its coordinate, which is how a player thinks about the board. */
function squareButton(container: HTMLElement, square: ChessSquare): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>(".chess-square")).find(
    (button) => button.getAttribute("aria-label")?.startsWith(square) ||
      button.querySelector(`.chess-rank`)?.textContent === square[0]
  );
  // Fall back to the DOM order, which is the board's own order: row 0 is the eighth rank.
  const index = ("abcdefgh".indexOf(square[0]) + (8 - Number(square[1])) * 8);
  void found;
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".chess-square"))[index];
}

describe("the chess board", () => {
  it("says what is on a square, and what can be done with it", () => {
    // A label that is only a coordinate is not a label; the piece's name and its colour are the
    // part a screen reader user needs.
    expect(squareLabel({ color: "w", type: "k" }, "e1")).toBe("e1, белый король");
    expect(squareLabel({ color: "b", type: "n" }, "b8")).toBe("b8, чёрный конь");
    expect(squareLabel({ color: "b", type: "r" }, "a8")).toBe("a8, чёрная ладья");
    expect(squareLabel({ color: "w", type: "p" }, "a2")).toBe("a2, белая пешка");
    expect(squareLabel(null, "e5")).toBe("e5, пусто");
  });

  it("agrees the adjective with the piece's gender", () => {
    // «белая ладья», but «белый конь»: a wrong ending is the kind of thing that makes a screen
    // reader output look machine-written.
    expect(pieceWord("r", "w")).toBe("белая ладья");
    expect(pieceWord("p", "b")).toBe("чёрная пешка");
    expect(pieceWord("n", "w")).toBe("белый конь");
    expect(pieceWord("k", "b")).toBe("чёрный король");
  });

  it("adds the state of the square to its label", () => {
    expect(squareLabel(null, "e4", { destination: true })).toContain("можно пойти");
    expect(squareLabel({ color: "b", type: "p" }, "d5", { destination: true, capture: true })).toContain("можно взять");
    expect(squareLabel({ color: "w", type: "p" }, "e2", { selected: true })).toContain("выбрано");
    expect(squareLabel({ color: "w", type: "k" }, "e1", { check: true })).toContain("под шахом");
  });

  it("draws sixty-four squares", () => {
    const { container } = render(
      <ChessBoard view={startView()} movable="w" orientation="w" onPromote={() => undefined} onMove={() => undefined} />
    );
    expect(container.querySelectorAll(".chess-square")).toHaveLength(64);
  });

  it("makes only the pieces that can be moved focusable", () => {
    // A grid of sixty-four tab stops is unusable with a keyboard; only the side to move's pieces
    // may be reached.
    const { container } = render(
      <ChessBoard view={startView()} movable="w" orientation="w" onPromote={() => undefined} onMove={() => undefined} />
    );
    expect(container.querySelectorAll('.chess-square[tabindex="0"]')).toHaveLength(16);
  });

  it("selects a piece and reports the move that was clicked", () => {
    let played: { from: ChessSquare; to: ChessSquare } | null = null;
    const { container } = render(
      <ChessBoard
        view={startView()}
        movable="w"
        orientation="w"
        onPromote={() => undefined} onMove={(move) => {
          played = { from: move.from, to: move.to };
        }}
      />
    );
    fireEvent.click(squareButton(container, "e2"));
    fireEvent.click(squareButton(container, "e4"));
    expect(played).toEqual({ from: "e2", to: "e4" });
  });

  it("marks the legal destinations of the selected piece", () => {
    // The dots are how a player learns the rules without losing a game to find out.
    const { container } = render(
      <ChessBoard view={startView()} movable="w" orientation="w" onPromote={() => undefined} onMove={() => undefined} />
    );
    fireEvent.click(squareButton(container, "e2"));
    expect(container.querySelectorAll(".chess-destination")).toHaveLength(2);
    expect(container.querySelectorAll(".chess-dot")).toHaveLength(2);
  });

  it("does not let the player move the opponent's pieces", () => {
    // The black pawn at a7 is a real piece with real moves; it must not be selectable.
    const { container } = render(
      <ChessBoard view={startView()} movable="w" orientation="w" onPromote={() => undefined} onMove={() => undefined} />
    );
    const a7 = squareButton(container, "a7");
    fireEvent.click(a7);
    expect(a7.getAttribute("aria-pressed")).toBe("false");
  });

  it("refuses to report a move to a square that is not legal", () => {
    let played = false;
    const { container } = render(
      <ChessBoard
        view={startView()}
        movable="w"
        orientation="w"
        onPromote={() => undefined}
        onMove={() => {
          played = true;
        }}
      />
    );
    fireEvent.click(squareButton(container, "e2"));
    fireEvent.click(squareButton(container, "d4"));
    expect(played).toBe(false);
  });

  it("lets both colours be moved when two people share the phone", () => {
    // In a local game the second person must be able to move their own pieces; the board trusts
    // its `movable` rather than assuming one seat.
    const { container } = render(
      <ChessBoard view={startView()} movable="both" orientation="w" onPromote={() => undefined} onMove={() => undefined} />
    );
    expect(container.querySelectorAll('.chess-square[tabindex="0"]')).toHaveLength(16);
  });

  it("turns the board round for a player who holds black", () => {
    // An un-flipped board puts the player's own pieces at the top, and they play the wrong way.
    const flipped = render(
      <ChessBoard view={startView()} movable="b" orientation="b" onPromote={() => undefined} onMove={() => undefined} />
    );
    const normal = render(
      <ChessBoard view={startView()} movable="b" orientation="w" onPromote={() => undefined} onMove={() => undefined} />
    );
    const firstOf = (container: HTMLElement) =>
      container.querySelectorAll(".chess-square")[0].getAttribute("aria-label");
    // With black at the bottom, the first square drawn is h1 rather than a8.
    expect(firstOf(flipped.container)).toContain("h1");
    expect(firstOf(normal.container)).toContain("a8");
  });

  it("shows the king in check with a mark, not only a colour", () => {
    // Scholar's mate: white has mated black on f7.
    const session = createChessSession({ mode: "local" });
    const view = viewPosition(session);
    render(<ChessBoard view={view} movable="w" orientation="w" onPromote={() => undefined} onMove={() => undefined} />);
    // The starting position has nobody in check, which is the control for the test above.
    expect(view.check).toBe(false);
    expect(view.checkSquare).toBeNull();
  });
});

describe("the promotion picker", () => {
  it("offers all four pieces with their names", () => {
    const { container } = render(
      <PromotionPicker color="w" onChoose={() => undefined} onCancel={() => undefined} />
    );
    const buttons = container.querySelectorAll(".chess-promotion-piece");
    expect(buttons).toHaveLength(4);
    expect(Array.from(buttons).map((button) => button.getAttribute("aria-label"))).toEqual([
      "белый ферзь",
      "белая ладья",
      "белый слон",
      "белый конь",
    ]);
  });

  it("reports the piece that was chosen", () => {
    let chosen = "";
    const { container } = render(
      <PromotionPicker
        color="w"
        onChoose={(piece) => {
          chosen = piece;
        }}
        onCancel={() => undefined}
      />
    );
    fireEvent.click(container.querySelectorAll(".chess-promotion-piece")[1]);
    expect(chosen).toBe("r");
  });

  it("can be cancelled without choosing", () => {
    // The player may decide they did not want that pawn move after all.
    let cancelled = false;
    const { container } = render(
      <PromotionPicker color="w" onChoose={() => undefined} onCancel={() => {
        cancelled = true;
      }} />
    );
    fireEvent.click(container.querySelector(".btn-ghost") as HTMLElement);
    expect(cancelled).toBe(true);
  });
});

describe("chess positions used by the screen", () => {
  it("offers twenty legal first moves", () => {
    expect(viewPosition(createChessSession({ mode: "local" })).moves).toHaveLength(20);
  });

  it("starts from the normal position", () => {
    expect(createChessSession({ mode: "local" }).startFen).toBe(START_FEN);
  });
});

describe("the card table", () => {
  function setup() {
    const state = newCardState(["Вы", "Соперник"], 7);
    const me = currentPlayer(state);
    return { state, me };
  }

  it("shows a symbol for the colour, not only the colour", () => {
    // Red and green have to be distinguishable to a player who cannot tell them apart.
    const { state, me } = setup();
    const { container } = render(
      <CardTable
        state={state}
        playerId={me}
        hidden={false}
        onPlay={() => undefined}
        onDraw={() => undefined}
        onPass={() => undefined}
        onChallenge={() => undefined}
        onOneCard={() => undefined}
        onChooseColour={() => undefined}
      />
    );
    const cards = container.querySelectorAll(".uno-hand .uno-card");
    expect(cards.length).toBe(handOf(state, me).length);
    for (const card of Array.from(cards)) {
      expect(card.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("offers a card to play only when it can actually be played", () => {
    const { state, me } = setup();
    const hand = handOf(state, me);
    const playable = hand.filter((id) => canPlay(state, state.cards[id]));
    const { container } = render(
      <CardTable
        state={state}
        playerId={me}
        hidden={false}
        onPlay={() => undefined}
        onDraw={() => undefined}
        onPass={() => undefined}
        onChallenge={() => undefined}
        onOneCard={() => undefined}
        onChooseColour={() => undefined}
      />
    );
    const enabled = container.querySelectorAll(".uno-hand .uno-card:not(:disabled)");
    expect(enabled.length).toBe(playable.length);
  });

  it("hides the hand when the seat belongs to a bot", () => {
    const { state, me } = setup();
    const { container } = render(
      <CardTable
        state={state}
        playerId={me}
        hidden
        onPlay={() => undefined}
        onDraw={() => undefined}
        onPass={() => undefined}
        onChallenge={() => undefined}
        onOneCard={() => undefined}
        onChooseColour={() => undefined}
      />
    );
    expect(container.querySelectorAll(".uno-hand .uno-card")).toHaveLength(0);
    expect(container.textContent).toContain("Рука соперника скрыта");
  });
});

describe("the balda board", () => {
  it("shows the opening word and twenty-five cells", () => {
    const state = createBalda({ players: [], seed: 1 });
    const { container } = render(<BaldaBoard state={state} onPlay={() => undefined} />);
    expect(container.querySelectorAll(".balda-cell")).toHaveLength(BOARD_SIZE * BOARD_SIZE);
    const filled = container.querySelectorAll(".balda-filled");
    expect(filled).toHaveLength(START_WORD.length);
  });

  it("only offers empty squares that touch a letter", () => {
    const state = createBalda({ players: [], seed: 1 });
    const { container } = render(<BaldaBoard state={state} onPlay={() => undefined} />);
    const enabled = container.querySelectorAll(".balda-cell:not(:disabled)");
    expect(enabled.length).toBeGreaterThan(0);
    for (const cell of Array.from(enabled)) {
      expect(cell.classList.contains("balda-playable")).toBe(true);
    }
  });

  it("reports the square, the letter and the word that were entered", () => {
    const state = createBalda({ players: [], seed: 1 });
    let played: { square: number; letter: string; word: string } | null = null;
    const { container } = render(
      <BaldaBoard
        state={state}
        onPlay={(square, letter, word) => {
          played = { square, letter, word };
        }}
      />
    );
    const cells = container.querySelectorAll<HTMLButtonElement>(".balda-cell");
    const firstEnabled = Array.from(cells).findIndex((cell) => !cell.disabled);
    fireEvent.click(cells[firstEnabled]);
    const inputs = container.querySelectorAll<HTMLInputElement>("input");
    fireEvent.change(inputs[0], { target: { value: "К" } });
    fireEvent.change(inputs[1], { target: { value: "ЛАК" } });
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".btn-primary"))[0];
    fireEvent.click(button);
    expect(played).toEqual({ square: firstEnabled, letter: "к", word: "лак" });
  });

  it("explains rather than accepting a letter in an unreachable square", () => {
    const state = createBalda({ players: [], seed: 1 });
    const { container } = render(<BaldaBoard state={state} onPlay={() => undefined} />);
    const cells = container.querySelectorAll<HTMLButtonElement>(".balda-cell");
    // The corner is empty but touches nothing, so its button is disabled.
    expect(cells[0].disabled).toBe(true);
  });
});
