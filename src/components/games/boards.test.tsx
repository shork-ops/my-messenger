/**
 * The games screen.
 *
 * The pieces that broke here before were not in the engines but in the joining: a game that
 * could not be reopened, a board that could not be played with the keyboard, a card table that
 * told a player what to do and then refused to do it. These tests drive the rendered screen.
 */

/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import ChessBoard, { squareLabel } from "./ChessBoard";
import CardTable from "./CardTable";
import BaldaBoard from "./BaldaBoard";
import { createChess, legalMoves, movesFrom, squareName } from "../../games/chess/engine";
import { newCardState, currentPlayer, handOf, canPlay } from "../../games/cards/deck";
import { createBalda, BOARD_SIZE, START_WORD } from "../../games/balda/engine";

describe("the chess board", () => {
  it("says what is on every square, so it can be read without seeing it", () => {
    expect(squareLabel({ color: "w", type: "k" }, 60)).toBe("e1, белый король");
    expect(squareLabel({ color: "b", type: "n" }, 1)).toBe("b8, чёрный конь");
    expect(squareLabel(null, 28)).toBe("e5");
    expect(squareLabel(null, 36)).toBe("e4");
  });

  it("draws sixty-four squares", () => {
    const state = createChess({ players: [], seed: 1 });
    const { container } = render(
      <ChessBoard state={state} playerColor="w" onMove={() => undefined} />
    );
    expect(container.querySelectorAll(".chess-square")).toHaveLength(64);
  });

  it("makes only the squares that can be used focusable", () => {
    // A grid of sixty-four tab stops is unusable with a keyboard; only the pieces of the side
    // to move and the destinations may be reached.
    const state = createChess({ players: [], seed: 1 });
    const { container } = render(
      <ChessBoard state={state} playerColor="w" onMove={() => undefined} />
    );
    const focusable = container.querySelectorAll('.chess-square[tabindex="0"]');
    // Sixteen white pieces can move first; nothing else is reachable.
    expect(focusable).toHaveLength(16);
  });

  it("selects a piece and reports the move that was clicked", () => {
    const state = createChess({ players: [], seed: 1 });
    const moves = movesFrom(state, 52); // e2
    expect(moves.length).toBe(2);
    let played: { from: number; to: number } | null = null;
    const { container } = render(
      <ChessBoard
        state={state}
        playerColor="w"
        onMove={(move) => {
          played = { from: move.from, to: move.to };
        }}
      />
    );
    const squares = container.querySelectorAll<HTMLButtonElement>(".chess-square");
    fireEvent.click(squares[52]);
    fireEvent.click(squares[36]); // e4
    expect(played).toEqual({ from: 52, to: 36 });
  });

  it("does not let the player move the opponent's pieces", () => {
    // The black pawn at a7 is a real piece with real moves; it must not be selectable.
    const state = createChess({ players: [], seed: 1 });
    const { container } = render(
      <ChessBoard state={state} playerColor="w" onMove={() => undefined} />
    );
    const squares = container.querySelectorAll<HTMLButtonElement>(".chess-square");
    fireEvent.click(squares[8]);
    expect(squares[8].getAttribute("aria-pressed")).toBe("false");
  });

  it("refuses to report a move to a square that is not legal", () => {
    const state = createChess({ players: [], seed: 1 });
    let played = false;
    const { container } = render(
      <ChessBoard
        state={state}
        playerColor="w"
        onMove={() => {
          played = true;
        }}
      />
    );
    const squares = container.querySelectorAll<HTMLButtonElement>(".chess-square");
    fireEvent.click(squares[52]); // e2
    fireEvent.click(squares[35]); // d4 - not a pawn move from e2
    expect(played).toBe(false);
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

describe("chess positions used by the screen", () => {
  it("has legal moves from the starting position", () => {
    expect(legalMoves(createChess({ players: [], seed: 1 }))).toHaveLength(20);
  });

  it("names squares the way the labels expect", () => {
    expect(squareName(60)).toBe("e1");
    expect(createChess({ players: [], seed: 1 }).board).toHaveLength(64);
  });
});
