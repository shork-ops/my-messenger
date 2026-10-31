/** @vitest-environment jsdom */
/**
 * Saved games belong to an account.
 *
 * Between "the save is written" and "the save is yours" there is a gap that this file closes: the
 * storage mechanics are covered in `storage.test.ts`, but mechanics that key on an account id prove
 * nothing unless all three games actually pass that id, write under it, and stay invisible to the
 * next person who signs in.
 *
 * These tests are written against the real save helpers rather than a mocked storage layer, because
 * the bug this guards against was not in the reading or the writing - it was in which key got used.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { BaldaState } from "../balda/engine";
import { createBalda } from "../balda/engine";
import { DICTIONARY_VERSION } from "../balda/dictionary";
import { newCardState, type CardState } from "../cards/deck";
import { CHESS_RULES_VERSION, createChessSession, START_FEN, type ChessSession } from "../chess/session";
import {
  browserStorage,
  canResume,
  storageKeyFor,
  takeLegacySessions,
  unfinishedByKind,
  upsertSession,
  type SavedSession,
} from "./storage";
import type { GameKind } from "./types";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";

/** A state of each kind, built by the real constructors rather than by hand. */
function stateFor(kind: GameKind): ChessSession | CardState | BaldaState {
  if (kind === "chess") return createChessSession({ mode: "bot", now: 1 });
  if (kind === "cards") return newCardState(["Вы", "Бот"], 1);
  return createBalda({
    players: [
      { id: "p1", name: "Вы", bot: false, seat: "x" },
      { id: "p2", name: "Бот", bot: true, seat: "o" },
    ],
    seed: 1,
  });
}

function rulesVersionFor(kind: GameKind): number {
  return kind === "chess" ? CHESS_RULES_VERSION : 1;
}

function save(kind: GameKind, overrides: Partial<SavedSession> = {}): SavedSession {
  const gameId = `saved-${kind}`;
  return {
    gameId,
    kind,
    rulesVersion: rulesVersionFor(kind),
    dictionaryVersion: DICTIONARY_VERSION,
    mode: "bot",
    status: "playing",
    createdAt: "2026-10-31T10:00:00.000Z",
    updatedAt: "2026-10-31T10:00:00.000Z",
    summary: `${kind} in progress`,
    state: stateFor(kind) as unknown,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("all three games save under the account that played them", () => {
  for (const kind of ["chess", "cards", "balda"] as GameKind[]) {
    it(`saves and reloads a ${kind} game for the same account`, () => {
      const storage = browserStorage(ALPHA);
      storage.write([save(kind)]);

      // A restart: a fresh `browserStorage` for the same account, as a new page load would build.
      const afterReload = browserStorage(ALPHA).read();
      expect(afterReload.map((item) => item.kind)).toEqual([kind]);
      expect(afterReload[0].gameId).toBe(`saved-${kind}`);
    });

    it(`does not show the ${kind} game to another account`, () => {
      browserStorage(ALPHA).write([save(kind)]);
      expect(browserStorage(BETA).read()).toEqual([]);
    });
  }

  it("keys the saves by account rather than by a shared name", () => {
    browserStorage(ALPHA).write([save("chess")]);
    browserStorage(BETA).write([save("chess")]);

    // Both exist at once, in different namespaces, and neither overwrote the other.
    expect(browserStorage(ALPHA).read()[0].summary).toBe("chess in progress");
    expect(browserStorage(BETA).read()[0].summary).toBe("chess in progress");
    expect(storageKeyFor(ALPHA)).not.toBe(storageKeyFor(BETA));
    expect(window.localStorage.getItem(storageKeyFor(ALPHA))).toBeTruthy();
    expect(window.localStorage.getItem(storageKeyFor(BETA))).toBeTruthy();
  });

  it("keeps one save per kind, so three games in progress is three entries", () => {
    const storage = browserStorage(ALPHA);
    storage.write([save("chess"), save("cards"), save("balda")]);
    const loaded = browserStorage(ALPHA).read();
    expect(loaded).toHaveLength(3);
    expect(loaded.map((item) => item.kind).sort()).toEqual(["balda", "cards", "chess"]);
  });

  it("offers each unfinished game back in the catalogue, per account", () => {
    browserStorage(ALPHA).write([save("chess"), save("cards"), save("balda")]);
    const mine = unfinishedByKind(browserStorage(ALPHA).read());
    expect(Object.keys(mine).sort()).toEqual(["balda", "cards", "chess"]);
    // The other account has nothing to continue.
    expect(unfinishedByKind(browserStorage(BETA).read())).toEqual({});
  });

  it("refuses to resume a card game saved under a different rule set", () => {
    const stale = save("cards", { rulesVersion: 0 });
    expect(canResume(stale, 1, DICTIONARY_VERSION)).toBe(false);
  });

  it("refuses to resume a balda game saved under an older dictionary", () => {
    // This is the reason the dictionary version is stored at all: swapping the word list changes
    // which words count, so a board mid-game could contain a word the new list rejects.
    const stale = save("balda", { dictionaryVersion: DICTIONARY_VERSION - 1 });
    expect(canResume(stale, 1, DICTIONARY_VERSION)).toBe(false);
    expect(canResume(save("balda"), 1, DICTIONARY_VERSION)).toBe(true);
  });

  it("does not hand one account's save to the next person through the legacy path", () => {
    // The pre-account key is the tempting place to look for "the game I was playing". Adopting it
    // for whoever signs in first is exactly the leak point 2 exists to close, so a save that names
    // an account is only adopted by that account.
    const legacy = save("chess", { accountId: ALPHA } as Partial<SavedSession>);
    // The pre-account format is a bare array, not the {version, sessions} envelope.
    window.localStorage.setItem("nexus.games.sessions", JSON.stringify([legacy]));

    expect(takeLegacySessions(BETA)).toEqual([]);
    expect(takeLegacySessions(ALPHA).map((item) => item.gameId)).toEqual([legacy.gameId]);
  });

  it("keeps an unowned legacy save where it is instead of deleting it", () => {
    const key = "nexus.games.sessions";
    const legacy = save("chess", { mode: "friend" });
    window.localStorage.setItem(key, JSON.stringify([legacy]));

    // Nobody can prove it is theirs, so nobody gets it - and it is not destroyed either, because
    // deleting it would be doing the wrong thing confidently.
    expect(takeLegacySessions(ALPHA)).toEqual([]);
    expect(window.localStorage.getItem(key)).toBeTruthy();
  });

  it("upserts within one account without disturbing another", () => {
    browserStorage(ALPHA).write([save("chess")]);
    browserStorage(BETA).write([save("chess")]);

    const replaced = upsertSession(browserStorage(ALPHA).read(), save("chess", { summary: "second try" }));
    browserStorage(ALPHA).write(replaced);

    expect(browserStorage(ALPHA).read()[0].summary).toBe("second try");
    // B still has exactly one save and it was not touched.
    expect(browserStorage(BETA).read()).toHaveLength(1);
  });

  it("starts a guest session in its own namespace, separate from every account", () => {
    browserStorage(null).write([save("balda")]);
    expect(browserStorage(ALPHA).read()).toEqual([]);
    expect(browserStorage(BETA).read()).toEqual([]);
    expect(browserStorage(null).read()).toHaveLength(1);
    expect(storageKeyFor(null)).not.toBe(storageKeyFor(ALPHA));
  });

  it("uses the real starting position for a saved chess game", () => {
    // A guard against the save format drifting from the engine: the stored state must be a position
    // the engine can still rebuild, otherwise "continue" opens a game that cannot be played.
    const saved = save("chess");
    const state = saved.state as ChessSession;
    expect(state.startFen).toBe(START_FEN);
    expect(state.moves).toEqual([]);
  });
});
