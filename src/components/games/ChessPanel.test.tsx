/**
 * The chess panel, driven the way a player drives it.
 *
 * The engine and the board are covered separately; this file covers the part where they meet and
 * where the plan's requirements live: a promotion asks before it moves, a claimable draw is offered
 * exactly when the rules allow it, a resignation ends the game and offers a new one, and the bot is
 * asked for a move only on its own turn.
 *
 * The panel is rendered against real sessions - not stubs - because the interesting failures are
 * about the two disagreeing: a button offered for a move the rules refuse, or a bot move applied to
 * a position that has already changed.
 */

/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChessPanel from "./ChessPanel";
import type { BotRunner } from "../../games/chess/useChessBot";
import {
  applyChessCommand,
  createChessSession,
  START_FEN,
  viewPosition,
  type ChessCommand,
  type ChessSquare,
  type ChessSession,
} from "../../games/chess/session";
import type { BotAnswer } from "../../games/chess/bot";

// The project does not enable vitest globals, so Testing Library cannot register its automatic
// cleanup between tests. Without this, a second render finds the first one still on screen and
// every query by role fails as ambiguous.
afterEach(cleanup);

/** A session from a position, so a test can put the game where it needs it. */
function sessionAt(fen: string, mode: "bot" | "local" = "local"): ChessSession {
  return createChessSession({ mode, startFen: fen, botColor: "b" });
}

/** Plays a list of moves in order, asserting each one was accepted. */
function played(session: ChessSession, moves: [ChessSquare, ChessSquare, ("q" | "r" | "b" | "n")?][]): ChessSession {
  let current = session;
  for (const [from, to, promotion] of moves) {
    const outcome = applyChessCommand(current, { type: "move", from, to, promotion });
    expect(outcome.changed).toBe(true);
    current = outcome.state;
  }
  return current;
}

/** A bot that never answers, for the cases where the bot must not be asked at all. */
function silentBot(): BotRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    request: (fen) => {
      calls.push(fen);
      return new Promise<BotAnswer | null>(() => undefined);
    },
    cancel: () => undefined,
  };
}

/** A bot that answers instantly with a fixed move. */
function scriptedBot(move: { from: string; to: string } | null): BotRunner & { calls: string[]; cancelled: number } {
  const calls: string[] = [];
  const state = { cancelled: 0 };
  return {
    calls,
    get cancelled() {
      return state.cancelled;
    },
    request: (fen) => {
      calls.push(fen);
      return Promise.resolve(
        move === null
          ? null
          : ({
              move: { from: move.from, to: move.to },
              score: 0,
              depth: 2,
              nodes: 1,
              stopped: false,
            } as BotAnswer)
      );
    },
    cancel: () => {
      state.cancelled += 1;
    },
  };
}

function renderPanel(options: {
  session: ChessSession;
  viewer?: "w" | "b" | "both";
  bot?: BotRunner;
  onCommand?: (command: ChessCommand) => void;
  onNewGame?: () => void;
}) {
  const onCommand = options.onCommand ?? vi.fn();
  const utils = render(
    <ChessPanel
      session={options.session}
      viewer={options.viewer ?? "w"}
      active
      bot={options.bot ?? silentBot()}
      onCommand={onCommand}
      onNewGame={options.onNewGame ?? vi.fn()}
      onExit={vi.fn()}
    />
  );
  return { ...utils, onCommand };
}

/** The square button by coordinate: the DOM order is chess.js's own, row 0 is the eighth rank. */
function square(container: HTMLElement, name: string): HTMLElement {
  const index = "abcdefgh".indexOf(name[0]) + (8 - Number(name[1])) * 8;
  return container.querySelectorAll<HTMLElement>(".chess-square")[index];
}

describe("making a move", () => {
  it("reports the move the player made", () => {
    const session = createChessSession({ mode: "local" });
    const { container, onCommand } = renderPanel({ session, viewer: "both" });
    fireEvent.click(square(container, "e2"));
    fireEvent.click(square(container, "e4"));
    expect(onCommand).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4", promotion: undefined });
  });

  it("does not report a move the rules refuse", () => {
    const session = createChessSession({ mode: "local" });
    const { container, onCommand } = renderPanel({ session, viewer: "both" });
    fireEvent.click(square(container, "e2"));
    // A rook move from a pawn's square is not a move at all.
    fireEvent.click(square(container, "e5"));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("does not let the player touch the opponent's side in a bot game", () => {
    const session = createChessSession({ mode: "bot", botColor: "b" });
    const { container, onCommand } = renderPanel({ session, viewer: "w" });
    fireEvent.click(square(container, "a7"));
    fireEvent.click(square(container, "a5"));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("lets both sides move when two people share the phone", () => {
    // The second person must be able to move their own pieces; the panel trusts `viewer`.
    const session = createChessSession({ mode: "local" });
    const { container, onCommand } = renderPanel({ session, viewer: "both" });
    fireEvent.click(square(container, "e2"));
    fireEvent.click(square(container, "e4"));
    expect(onCommand).toHaveBeenCalled();
  });
});

describe("promotion", () => {
  const promotionFen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";

  it("asks which piece before it moves", () => {
    // The choice decides whether the move is mate, so it must not be made for the player.
    const { container, onCommand } = renderPanel({ session: sessionAt(promotionFen), viewer: "both" });
    fireEvent.click(square(container, "a7"));
    fireEvent.click(square(container, "a8"));
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Превращение пешки" })).toBeTruthy();
  });

  it("offers all four pieces to choose from", () => {
    const { container } = renderPanel({ session: sessionAt(promotionFen), viewer: "both" });
    fireEvent.click(square(container, "a7"));
    fireEvent.click(square(container, "a8"));
    const names = Array.from(document.querySelectorAll(".chess-promotion-piece")).map((button) =>
      button.getAttribute("aria-label")
    );
    expect(names).toEqual(["белый ферзь", "белая ладья", "белый слон", "белый конь"]);
  });

  it("sends the move with the piece that was chosen", () => {
    const { container, onCommand } = renderPanel({ session: sessionAt(promotionFen), viewer: "both" });
    fireEvent.click(square(container, "a7"));
    fireEvent.click(square(container, "a8"));
    fireEvent.click(document.querySelectorAll(".chess-promotion-piece")[1]);
    expect(onCommand).toHaveBeenCalledWith({ type: "move", from: "a7", to: "a8", promotion: "r" });
  });

  it("moves the pawn nowhere when the question is cancelled", () => {
    const { container, onCommand } = renderPanel({ session: sessionAt(promotionFen), viewer: "both" });
    fireEvent.click(square(container, "a7"));
    fireEvent.click(square(container, "a8"));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Превращение пешки" })).toBeNull();
  });
});

describe("the draw rules are two different things", () => {
  it("refuses the claim button before three repetitions", () => {
    // Two repetitions is not a claim; the button says so rather than acting and being refused.
    const session = played(createChessSession({ mode: "local" }), [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
      ["g1", "f3"],
      ["g8", "f6"],
    ]);
    const { container } = renderPanel({ session, viewer: "both" });
    // The disabled button still names the threshold, so a player learns the rule from it rather
    // than from a refusal.
    const claimButton = container.querySelector<HTMLButtonElement>(".chess-controls button")!;
    expect(claimButton.textContent).toContain("Ничья (3)");
    expect(claimButton.disabled).toBe(true);
    // ...and the enabled claim is not offered, because the rules do not allow it yet.
    expect(screen.queryByRole("button", { name: "Заявить ничью" })).toBeNull();
  });

  it("lets the player claim once three repetitions have happened", () => {
    const session = played(createChessSession({ mode: "local" }), [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
    ]);
    const { onCommand } = renderPanel({ session, viewer: "both" });
    const button = screen.getByRole("button", { name: "Заявить ничью" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    // The command names the side claiming, so the engine can refuse a claim by the wrong one.
    expect(onCommand).toHaveBeenCalledWith({ type: "claim-draw", by: expect.stringMatching(/^[wb]$/) });
  });

  it("offers a draw to the opponent rather than ending the game", () => {
    const session = createChessSession({ mode: "local" });
    const { onCommand } = renderPanel({ session, viewer: "both" });
    fireEvent.click(screen.getByRole("button", { name: "Предложить ничью" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "offer-draw", by: expect.stringMatching(/^[wb]$/) });
  });

  it("shows an offer from the opponent and can accept it", () => {
    // A draw is an agreement: it only counts when the other side accepts.
    let session = createChessSession({ mode: "local" });
    session = applyChessCommand(session, { type: "offer-draw", by: "w" }).state;
    const { container, onCommand } = renderPanel({ session, viewer: "b" });
    // The offer appears both in the status line and in the block with the buttons, so this looks
    // at the block rather than at the whole document.
    expect(container.querySelector(".chess-offer")?.textContent).toContain("Соперник предложил ничью");
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "accept-draw", by: expect.stringMatching(/^[wb]$/) });
  });
});

describe("ending a game", () => {
  it("offers resignation while the game is running", () => {
    const session = createChessSession({ mode: "local" });
    const { onCommand } = renderPanel({ session, viewer: "both" });
    fireEvent.click(screen.getByRole("button", { name: "Сдаться" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "resign", by: expect.stringMatching(/^[wb]$/) });
  });

  it("shows the result and a way to play again once the game is over", () => {
    // Fool's mate: black has mated white.
    const session = played(createChessSession({ mode: "local" }), [
      ["f2", "f3"],
      ["e7", "e5"],
      ["g2", "g4"],
      ["d8", "h4"],
    ]);
    const onNewGame = vi.fn();
    renderPanel({ session, viewer: "w", onNewGame });
    expect(screen.getByText(/Вы проиграли/)).toBeTruthy();
    // The controls for a running game are gone: offering a draw in a mated position is nonsense.
    expect(screen.queryByRole("button", { name: "Сдаться" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Новая партия" }));
    expect(onNewGame).toHaveBeenCalled();
  });

  it("tells the winner that they won, not merely that the game ended", () => {
    const session = played(createChessSession({ mode: "local" }), [
      ["f2", "f3"],
      ["e7", "e5"],
      ["g2", "g4"],
      ["d8", "h4"],
    ]);
    renderPanel({ session, viewer: "b" });
    expect(screen.getByText(/Вы выиграли/)).toBeTruthy();
  });

  it("stops the board from being played after the game is over", () => {
    const session = played(createChessSession({ mode: "local" }), [
      ["f2", "f3"],
      ["e7", "e5"],
      ["g2", "g4"],
      ["d8", "h4"],
    ]);
    const { container, onCommand } = renderPanel({ session, viewer: "b" });
    fireEvent.click(square(container, "a2"));
    fireEvent.click(square(container, "a4"));
    expect(onCommand).not.toHaveBeenCalled();
  });
});

describe("the bot", () => {
  it("is asked for a move when it is its turn", async () => {
    const session = createChessSession({ mode: "bot", botColor: "b" });
    // White has just moved, so it is black's - the bot's - turn.
    const afterMove = applyChessCommand(session, { type: "move", from: "e2", to: "e4" }).state;
    const bot = scriptedBot({ from: "e7", to: "e5" });
    const { onCommand } = renderPanel({ session: afterMove, viewer: "w", bot });
    await waitFor(() => expect(onCommand).toHaveBeenCalled());
    expect(bot.calls).toHaveLength(1);
    expect(onCommand).toHaveBeenCalledWith({ type: "move", from: "e7", to: "e5", promotion: undefined });
  });

  it("is not asked for a move on the player's turn", () => {
    const session = createChessSession({ mode: "bot", botColor: "b" });
    const bot = silentBot();
    renderPanel({ session, viewer: "w", bot });
    expect(bot.calls).toHaveLength(0);
  });

  it("is not asked in a game between two people", () => {
    const session = createChessSession({ mode: "local" });
    const afterMove = applyChessCommand(session, { type: "move", from: "e2", to: "e4" }).state;
    const bot = silentBot();
    renderPanel({ session: afterMove, viewer: "both", bot });
    expect(bot.calls).toHaveLength(0);
  });

  it("is not asked once the game is over", () => {
    // A mated bot must not be asked to move; there is no move.
    const session = played(createChessSession({ mode: "bot", botColor: "b" }), [
      ["f2", "f3"],
      ["e7", "e5"],
      ["g2", "g4"],
      ["d8", "h4"],
    ]);
    const bot = silentBot();
    renderPanel({ session, viewer: "w", bot });
    expect(bot.calls).toHaveLength(0);
  });

  it("abandons its search when the screen goes away", () => {
    const session = createChessSession({ mode: "bot", botColor: "b" });
    const afterMove = applyChessCommand(session, { type: "move", from: "e2", to: "e4" }).state;
    const bot = scriptedBot({ from: "e7", to: "e5" });
    const { unmount } = renderPanel({ session: afterMove, viewer: "w", bot });
    unmount();
    // Closing the screen must release the search rather than leave it running.
    expect(bot.cancelled).toBeGreaterThan(0);
  });

  it("does not apply an answer for a position that has moved on", async () => {
    // The response arrives for an older FEN: applying it would put a move on the wrong board.
    const session = createChessSession({ mode: "bot", botColor: "b" });
    const afterMove = applyChessCommand(session, { type: "move", from: "e2", to: "e4" }).state;
    const bot: BotRunner = {
      // A move that is not legal in this position - the panel must not pass it on.
      request: () =>
        Promise.resolve({ move: { from: "a1", to: "a8" }, score: 0, depth: 1, nodes: 1, stopped: false }),
      cancel: () => undefined,
    };
    const onCommand = vi.fn();
    renderPanel({ session: afterMove, viewer: "w", bot, onCommand });
    await waitFor(() => expect(screen.getByText(/не подошёл к позиции/)).toBeTruthy());
    expect(onCommand).not.toHaveBeenCalled();
  });
});

describe("what the panel reports", () => {
  it("names the side to move", () => {
    renderPanel({ session: createChessSession({ mode: "local" }), viewer: "both" });
    expect(screen.getByRole("status").textContent).toContain("Ход белых");
  });

  it("says whose turn it is from the player's point of view in a bot game", () => {
    renderPanel({ session: createChessSession({ mode: "bot", botColor: "b" }), viewer: "w" });
    expect(screen.getByRole("status").textContent).toContain("Ваш ход");
  });

  it("lists the moves that have been played", () => {
    const session = played(createChessSession({ mode: "local" }), [
      ["e2", "e4"],
      ["e7", "e5"],
    ]);
    renderPanel({ session, viewer: "both" });
    const moves = screen.getByRole("list", { name: "" }) as HTMLElement;
    expect(moves.textContent).toContain("e4");
    expect(moves.textContent).toContain("e5");
  });

  it("shows the material balance honestly", () => {
    // Black is a queen up; "равный материал" here would be a lie.
    const session = sessionAt("4k3/8/8/8/8/8/8/4K2q w - - 0 1");
    renderPanel({ session, viewer: "w" });
    expect(screen.getByText(/Чёрные впереди на 9 пешек/)).toBeTruthy();
  });

  it("starts from the ordinary position", () => {
    const session = createChessSession({ mode: "local" });
    expect(session.startFen).toBe(START_FEN);
    expect(viewPosition(session).moves).toHaveLength(20);
  });
});
