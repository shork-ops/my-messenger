/**
 * The starting position an invitation opens.
 *
 * This is the seam where "a message was sent" becomes "a game exists". The states built here travel
 * to the server and come back on the other player's screen, so they have to be states the engines
 * actually accept - not merely JSON that happens to be shaped like one.
 *
 * The tests therefore feed each state back into its own engine. A state that the engine refuses to
 * continue from would be a game where nobody can move, and it would only surface once two people
 * were already sitting in front of it.
 */

import { describe, expect, it, vi } from "vitest";
import { initialNetworkState, openInvitedGame, rulesVersionFor, seatsFor } from "./inviteGame";
import { CHESS_RULES_VERSION, applyChessCommand, toChess } from "../chess/session";
import { applyCardAction, newCardState } from "../cards/deck";
import { baldaEngine } from "../balda/engine";
import { DICTIONARY_VERSION } from "../balda/dictionary";

vi.mock("./gameServer", () => ({
  createServerGame: vi.fn(async () => ({ ok: true, value: "game-abc" })),
}));

describe("how many seats an invitation opens", () => {
  it("opens two seats, because an invitation goes to one chat", () => {
    expect(seatsFor("chess")).toBe(2);
    expect(seatsFor("balda")).toBe(2);
    // The card game's server function accepts up to four; an invitation starts at two so the game
    // can begin with the person who was actually invited.
    expect(seatsFor("cards")).toBe(2);
  });
});

describe("the rules version recorded with a game", () => {
  it("records the version the engine is actually running", () => {
    expect(rulesVersionFor("chess")).toBe(CHESS_RULES_VERSION);
    expect(rulesVersionFor("balda")).toBe(baldaEngine.rulesVersion);
    expect(rulesVersionFor("cards")).toBe(1);
  });

  it("is not a literal that could drift from the chess rules", () => {
    // Chess is on version 3 after the fifty-move fix. Pinned literally so a bump to the constant
    // without thinking about old games fails here rather than silently reinterpreting them.
    expect(CHESS_RULES_VERSION).toBe(3);
  });
});

describe("the starting position of each game", () => {
  it("gives chess the normal opening position, with white to move", () => {
    const state = initialNetworkState("chess", ["Аня", "Борис"], 1);
    const session = state as never;
    const chess = toChess(session);
    expect(chess.turn()).toBe("w");
    expect(chess.history()).toHaveLength(0);
    // The engine must be able to continue from it: the very first move has to work.
    const outcome = applyChessCommand(session, { type: "move", from: "e2", to: "e4" });
    expect(outcome.changed).toBe(true);
  });

  it("names both seats, so an old game still reads correctly", () => {
    const state = initialNetworkState("chess", ["Аня", "Борис"], 1) as { players: { white: string; black: string } };
    expect(state.players.white).toBe("Аня");
    expect(state.players.black).toBe("Борис");
  });

  it("leaves botColor null, because nobody in a networked game is a bot", () => {
    // This matters: `viewerColor` in the game screen reads botColor to decide which seat is yours.
    // A non-null bot colour would make the screen insist the player is the bot.
    const state = initialNetworkState("chess", ["Аня", "Борис"], 1) as { botColor: string | null };
    expect(state.botColor).toBeNull();
  });

  it("deals the card game from the seed, so the same seed gives the same deal", () => {
    const first = initialNetworkState("cards", ["Аня", "Борис"], 4242);
    const again = initialNetworkState("cards", ["Аня", "Борис"], 4242);
    expect(again).toEqual(first);
    // A different seed must give a different deal, or the "shuffle" is theatre.
    const other = initialNetworkState("cards", ["Аня", "Борис"], 4243);
    expect(other).not.toEqual(first);
  });

  it("gives the card game two hands of seven from one deck", () => {
    const state = initialNetworkState("cards", ["Аня", "Борис"], 9999) as ReturnType<typeof newCardState>;
    expect(state.hands).toHaveLength(2);
    expect(state.hands[0].cards).toHaveLength(7);
    expect(state.hands[1].cards).toHaveLength(7);
    // No card may appear twice across both hands and the discard.
    const seen = new Set<string>();
    for (const id of [...state.hands[0].cards, ...state.hands[1].cards, ...state.discard]) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it("gives «Балда» the five-letter starting word and a usable board", () => {
    const state = initialNetworkState("balda", ["Аня", "Борис"], 777) as never;
    const board = (state as { board: (string | null)[] }).board;
    expect(board.filter(Boolean)).toHaveLength(5);
    expect(board.join("")).toContain("Б");
    // The engine has to accept the state.
    expect(baldaEngine.result(state)).toBeNull();
  });

  it("accepts the card state well enough to take a turn from it", () => {
    const state = initialNetworkState("cards", ["Аня", "Борис"], 1234) as ReturnType<typeof newCardState>;
    // Drawing is always available, so this proves the state is not malformed rather than proving a
    // particular card is playable.
    const outcome = applyCardAction(state, { type: "draw" });
    expect(typeof outcome.changed).toBe("boolean");
  });
});

describe("opening the game for an invitation", () => {
  it("asks the server for a game of the right kind and returns its id", async () => {
    const result = await openInvitedGame("chess", "chat-1", "Борис", () => 0.5);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe("game-abc");
  });

  it("records the «Балда» dictionary, so a game is tied to the word list it was played under", async () => {
    const { createServerGame } = await import("./gameServer");
    const mocked = vi.mocked(createServerGame);
    mocked.mockClear();
    await openInvitedGame("balda", "chat-1", "Борис", () => 0.25);
    const options = mocked.mock.calls[0][0];
    expect(options.dictionaryVersion).toBe(DICTIONARY_VERSION);
    expect(options.dictionaryChecksum).toMatch(/^[0-9a-f]{8}$/);
  });

  it("records no dictionary for the games that have none", async () => {
    const { createServerGame } = await import("./gameServer");
    const mocked = vi.mocked(createServerGame);
    mocked.mockClear();
    await openInvitedGame("chess", "chat-1", "Борис", () => 0.25);
    expect(mocked.mock.calls[0][0].dictionaryVersion).toBeNull();
    expect(mocked.mock.calls[0][0].dictionaryChecksum).toBeNull();
  });

  it("turns a fraction from the random source into a whole-number seed", async () => {
    const { createServerGame } = await import("./gameServer");
    const mocked = vi.mocked(createServerGame);
    mocked.mockClear();
    await openInvitedGame("cards", "chat-1", "Борис", () => 0.5);
    const state = mocked.mock.calls[0][0].initialState as { seed: number };
    expect(Number.isInteger(state.seed)).toBe(true);
    expect(state.seed).toBeGreaterThanOrEqual(0);
  });
});
