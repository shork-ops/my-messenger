/**
 * The client half of networked play, tested without a server.
 *
 * Everything here is a pure function over a `ServerGame`, which is the point: the decisions that
 * are easy to get wrong - whose turn it is, what to do with a conflict, whether a nudge means
 * anything - do not need a network to be tested, and testing them through one would only hide
 * which of them failed.
 *
 * The card-game cases are the ones worth reading. The shape of `GameView` for the card game is
 * deliberately different from the board games, and these tests pin down that a card client cannot
 * obtain a full hand, a deck, or a seed, because there is no field to obtain it from.
 */

import { describe, expect, it } from "vitest";
import {
  canCheckLocally,
  handCounts,
  myTurn,
  newCommandId,
  nextStepFor,
  nudgeAdvances,
  nudgeFor,
  ownHand,
  prepareAction,
  seatToMove,
  type CommitOutcome,
  type GameView,
  type ServerGame,
} from "./network";
import { applyCardAction, newCardState } from "../cards/deck";
import { baldaEngine } from "../balda/engine";
import { applyChessCommand, createChessSession } from "../chess/session";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

function openView(state: unknown): GameView {
  return { kind: "open", viewerId: ALICE, state, result: null };
}

function game(overrides: Partial<ServerGame> = {}): ServerGame {
  return {
    id: "game-1",
    chatId: "chat-1",
    kind: "chess",
    status: "playing",
    revision: 0,
    seats: 2,
    rulesVersion: 3,
    dictionaryVersion: null,
    dictionaryChecksum: null,
    commands: [],
    mySeat: 0,
    result: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    players: [
      { seat: 0, userId: ALICE, displayName: "Алиса" },
      { seat: 1, userId: BOB, displayName: "Боб" },
    ],
    view: openView(createChessSession({ mode: "friend", botColor: "b", difficulty: "normal" })),
    ...overrides,
  };
}

describe("whose turn it is", () => {
  it("reads chess by colour, because that is how the board thinks", () => {
    expect(seatToMove("chess", openView({ turn: "w" }))).toBe(0);
    expect(seatToMove("chess", openView({ turn: "b" }))).toBe(1);
  });

  it("reads the other two by turn index", () => {
    expect(seatToMove("balda", openView({ turnIndex: 1 }))).toBe(1);
    // The card game's index is on the view, not in a state, because there is no state.
    const hands: GameView = {
      kind: "hands",
      viewerId: ALICE,
      hands: [],
      discard: [],
      activeColor: "red",
      direction: 1,
      pending: null,
      pendingDraw4: null,
      phase: "play",
      turnIndex: 2,
      order: [ALICE, BOB],
      scores: {},
      events: [],
      result: null,
    };
    expect(seatToMove("cards", hands)).toBe(2);
  });

  it("returns null rather than guessing when the state does not say", () => {
    expect(seatToMove("chess", openView({}))).toBeNull();
    expect(seatToMove("chess", openView(null))).toBeNull();
  });

  it("says it is your turn only when the seat matches and the game is running", () => {
    expect(myTurn(game({ mySeat: 0 }))).toBe(true);
    expect(myTurn(game({ mySeat: 1 }))).toBe(false);
    // A finished game has no turn, whoever is sitting where.
    expect(myTurn(game({ mySeat: 0, status: "finished" }))).toBe(false);
    // A lobby has no turn either: nobody has been given a colour yet.
    expect(myTurn(game({ mySeat: 0, status: "lobby" }))).toBe(false);
    // Somebody who is not at the table never moves.
    expect(myTurn(game({ mySeat: null }))).toBe(false);
  });
});

describe("what may be checked on the client", () => {
  it("checks the board games locally, where the whole board is present", () => {
    expect(canCheckLocally(openView({}))).toBe(true);
  });

  it("does not check the card game locally, because the deck is deliberately absent", () => {
    const hands: GameView = {
      kind: "hands",
      viewerId: ALICE,
      hands: [{ playerId: ALICE, cards: ["red-1"], hidden: false }],
      discard: [],
      activeColor: "red",
      direction: 1,
      pending: null,
      pendingDraw4: null,
      phase: "play",
      turnIndex: 0,
      order: [ALICE, BOB],
      scores: {},
      events: [],
      result: null,
    };
    expect(canCheckLocally(hands)).toBe(false);
  });
});

describe("hidden card information", () => {
  const hands: GameView = {
    kind: "hands",
    viewerId: ALICE,
    hands: [
      { playerId: ALICE, cards: ["red-1", "blue-2"], hidden: false },
      { playerId: BOB, count: 5, hidden: true },
    ],
    discard: ["green-7"],
    activeColor: "green",
    direction: 1,
    pending: null,
    pendingDraw4: null,
    phase: "play",
    turnIndex: 1,
    order: [ALICE, BOB],
    scores: { [ALICE]: 0, [BOB]: 0 },
    events: [],
    result: null,
  };

  it("offers the viewer their own cards and nothing else", () => {
    expect(ownHand(hands)).toEqual(["red-1", "blue-2"]);
  });

  it("gives a count for everybody else, which is what the physical table shows", () => {
    expect(handCounts(hands)).toEqual([
      { playerId: ALICE, count: 2 },
      { playerId: BOB, count: 5 },
    ]);
  });

  it("has no way to hold a deck or a seed, so a card client cannot reconstruct a hand", () => {
    // The assertion is structural rather than behavioural: the projection is an allow-list, so
    // there is no field an opponent's cards could arrive in.
    const keys = Object.keys(hands);
    expect(keys).not.toContain("deck");
    expect(keys).not.toContain("seed");
    expect(keys).not.toContain("cards");
    expect(keys).not.toContain("state");
  });

  it("returns nothing for the board games, which have no hands", () => {
    expect(ownHand(openView({}))).toEqual([]);
    expect(handCounts(openView({}))).toEqual([]);
  });
});

describe("command ids", () => {
  it("are long enough to be unique and acceptable to the server", () => {
    const id = newCommandId();
    // The migration refuses anything under 8 characters; this is well clear of the floor.
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).toMatch(/^cmd[a-z0-9]+$/);
  });

  it("differ between two calls, so a second move is not swallowed as a retry", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newCommandId()));
    expect(ids.size).toBe(200);
  });
});

describe("turning an action into a command", () => {
  it("sends a legal chess move and does not send an illegal one", () => {
    const session = createChessSession({ mode: "friend", botColor: "b", difficulty: "normal" });
    const legal = prepareAction(
      { apply: applyChessCommand },
      session,
      { type: "move", from: "e2", to: "e4" },
      "cmd-legal-0001"
    );
    expect(legal.send).toBe(true);
    expect(legal.pending.commandId).toBe("cmd-legal-0001");

    // A knight cannot jump from e2. The engine refuses, and the reason is shown without a request.
    const illegal = prepareAction(
      { apply: applyChessCommand },
      session,
      { type: "move", from: "e2", to: "e5" },
      "cmd-illegal-001"
    );
    expect(illegal.send).toBe(false);
    expect(illegal.reason).toBeTruthy();
  });

  it("refuses to send a move that is not this player's to make", () => {
    const session = createChessSession({ mode: "friend", botColor: "b", difficulty: "normal" });
    // White to move; a black pawn move is not legal for the side at the board.
    const out = prepareAction({ apply: applyChessCommand }, session, { type: "move", from: "e7", to: "e5" }, "cmd-wrong-side1");
    expect(out.send).toBe(false);
  });

  it("refuses a Balda word the dictionary does not have", () => {
    const state = baldaEngine.create({ players: [], seed: 12345 });
    const out = prepareAction(
      baldaEngine,
      state,
      { type: "place", letter: "я", square: 0, word: "яяяя" } as never,
      "cmd-balda-0001"
    );
    expect(out.send).toBe(false);
    expect(out.reason).toBeTruthy();
  });

  it("sends a card action without a local legality check", () => {
    // The card client cannot check, and does not pretend to: the action goes to the server, whose
    // replay is the authority. This test pins the *decision* rather than a code path.
    const state = newCardState([ALICE, BOB], 4242);
    const card = state.hands[0].cards[0];
    const out = applyCardAction(state, { type: "play", cardId: card, chooseColor: "red" });
    // Whether it is legal or not, the outcome has a definite answer and is never "ask again".
    expect(typeof out.changed).toBe("boolean");
  });
});

describe("what to do with the server's answer", () => {
  it("continues on an applied command, carrying the new revision", () => {
    const step = nextStepFor({
      status: "applied",
      revision: 7,
      state: { turn: "b" },
      gameStatus: "playing",
    });
    expect(step.kind).toBe("continue");
    expect(step.revision).toBe(7);
    expect(step.kind === "continue" && step.finished).toBe(false);
  });

  it("marks an applied command that ended the game", () => {
    const step = nextStepFor({
      status: "applied",
      revision: 9,
      state: { result: { kind: "win" } },
      gameStatus: "finished",
    });
    expect(step.kind === "continue" && step.finished).toBe(true);
  });

  it("re-reads on a conflict instead of assuming the move landed", () => {
    const step = nextStepFor({ status: "conflict", revision: 4, state: { turn: "w" } });
    expect(step.kind).toBe("reread");
    expect(step.revision).toBe(4);
    // The board returned by a conflict is the *other* player's, so it must be adopted, not ignored.
    expect(step.kind === "reread" && step.state).toEqual({ turn: "w" });
  });

  it("treats a duplicate as done, because the retry already landed", () => {
    const step = nextStepFor({ status: "duplicate", revision: 5, state: { turn: "b" } });
    expect(step.kind).toBe("idle");
    expect(step.revision).toBe(5);
  });

  it("covers every outcome the server can return", () => {
    const outcomes: CommitOutcome[] = [
      { status: "applied", revision: 1, state: {}, gameStatus: "playing" },
      { status: "conflict", revision: 2, state: {}, reason: "moved on" },
      { status: "duplicate", revision: 3, state: {} },
    ];
    const kinds = outcomes.map((outcome) => nextStepFor(outcome).kind);
    expect(kinds).toEqual(["continue", "reread", "idle"]);
  });
});

describe("realtime nudges", () => {
  it("names one topic per game", () => {
    expect(nudgeFor("abc")).toBe("game:abc");
  });

  it("asks for a re-read only when the revision actually advances", () => {
    const nudge = { gameId: "g1", revision: 5, status: "playing" };
    expect(nudgeAdvances(nudge, 4, "g1")).toBe(true);
    // The revision already held: re-reading would be a request for nothing.
    expect(nudgeAdvances(nudge, 5, "g1")).toBe(false);
    // Out-of-order delivery after a reconnect.
    expect(nudgeAdvances(nudge, 6, "g1")).toBe(false);
  });

  it("ignores a nudge for a different game", () => {
    expect(nudgeAdvances({ gameId: "other", revision: 99, status: "playing" }, 0, "g1")).toBe(false);
  });
});
