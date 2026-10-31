/** @vitest-environment jsdom */
/**
 * Saved games.
 *
 * The promise is simple and was broken before: close a game and you find it where you left it.
 * The tests below are about the ways that promise breaks in practice - a corrupt save, a save
 * from an older rule set, a full storage quota - rather than about the happy path.
 */

import { describe, expect, it } from "vitest";
import {
  browserStorage,
  canResume,
  memoryStorage,
  prune,
  removeSession,
  resumeLabel,
  STORAGE_KEY,
  STORAGE_VERSION,
  timeAgo,
  unfinishedByKind,
  upsertSession,
  type SavedSession,
} from "./storage";
import type { GameKind } from "./types";

let counter = 0;

function session(overrides: Partial<SavedSession> = {}): SavedSession {
  counter += 1;
  return {
    gameId: `game-${counter}`,
    kind: "chess",
    rulesVersion: 1,
    dictionaryVersion: 1,
    mode: "bot",
    status: "playing",
    createdAt: "2026-10-31T10:00:00.000Z",
    updatedAt: "2026-10-31T10:00:00.000Z",
    summary: "белые, 12-й ход",
    state: { turn: "b" },
    ...overrides,
  };
}

describe("the storage version", () => {
  it("exists so an old save is not guessed at", () => {
    expect(STORAGE_VERSION).toBeGreaterThan(0);
  });
});

describe("reading and writing", () => {
  it("returns nothing when nothing was saved", () => {
    expect(memoryStorage().read()).toEqual([]);
  });

  it("round-trips a saved game", () => {
    const storage = memoryStorage();
    const saved = session();
    storage.write([saved]);
    expect(storage.read()).toEqual([saved]);
  });

  it("survives a corrupt value in browser storage", () => {
    // A JSON parse that throws must not take the games screen down with it.
    const original = window.localStorage;
    const store = new Map<string, string>([[STORAGE_KEY, "{not json"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
    try {
      expect(browserStorage().read()).toEqual([]);
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: original });
    }
  });

  it("drops entries that are the wrong shape", () => {
    const original = window.localStorage;
    const store = new Map<string, string>([
      [STORAGE_KEY, JSON.stringify([{ gameId: "x" }, { nothing: true }, session()])],
    ]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
    try {
      const read = browserStorage().read();
      expect(read).toHaveLength(1);
      expect(read[0].kind).toBe("chess");
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: original });
    }
  });

  it("does not throw when storage refuses to write", () => {
    // Private windows throw on setItem; the game must keep working in memory.
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => undefined,
      },
    });
    try {
      expect(() => browserStorage().write([session()])).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: original });
    }
  });
});

describe("resuming", () => {
  it("resumes a game saved under the same rules and dictionary", () => {
    expect(canResume(session(), 1, 1)).toBe(true);
  });

  it("refuses a game saved under different rules", () => {
    // Replaying a committed position under new rules is not the same game.
    expect(canResume(session({ rulesVersion: 1 }), 2, 1)).toBe(false);
  });

  it("refuses a game saved under a different dictionary", () => {
    // Otherwise a player is told a word they already played is invalid.
    expect(canResume(session({ dictionaryVersion: 1 }), 1, 2)).toBe(false);
  });

  it("refuses a finished game", () => {
    expect(canResume(session({ status: "finished" }), 1, 1)).toBe(false);
  });
});

describe("the catalogue", () => {
  it("offers the most recently played unfinished game of each kind", () => {
    const older = session({ kind: "cards", updatedAt: "2026-10-31T09:00:00.000Z" });
    const newer = session({ kind: "cards", updatedAt: "2026-10-31T11:00:00.000Z" });
    const chess = session({ kind: "chess" });
    const map = unfinishedByKind([older, newer, chess]);
    expect(map.cards?.gameId).toBe(newer.gameId);
    expect(map.chess?.gameId).toBe(chess.gameId);
  });

  it("does not offer a finished game as something to continue", () => {
    const done = session({ kind: "balda" as GameKind, status: "finished" });
    expect(unfinishedByKind([done]).balda).toBeUndefined();
  });
});

describe("the list of saves", () => {
  it("replaces an existing game instead of duplicating it", () => {
    const first = session();
    const updated = { ...first, updatedAt: "2026-10-31T12:00:00.000Z", summary: "новый ход" };
    const list = upsertSession([first], updated);
    expect(list).toHaveLength(1);
    expect(list[0].summary).toBe("новый ход");
  });

  it("keeps the newest first", () => {
    const old = session({ updatedAt: "2026-10-31T08:00:00.000Z" });
    const recent = session({ updatedAt: "2026-10-31T12:00:00.000Z" });
    const list = upsertSession([old], recent);
    expect(list[0].gameId).toBe(recent.gameId);
  });

  it("removes a game the player is done with", () => {
    const one = session();
    expect(removeSession([one], one.gameId)).toEqual([]);
  });

  it("keeps every unfinished game and only the newest finished ones", () => {
    // Without pruning the quota fills up and saving stops working for everyone, silently.
    const sessions: SavedSession[] = [];
    for (let i = 0; i < 5; i += 1) {
      sessions.push(session({ status: "playing", updatedAt: `2026-10-31T0${i}:00:00.000Z` }));
    }
    for (let i = 0; i < 30; i += 1) {
      sessions.push(session({ status: "finished", updatedAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
    }
    const kept = prune(sessions, 10);
    expect(kept.filter((item) => item.status === "playing")).toHaveLength(5);
    expect(kept.filter((item) => item.status !== "playing")).toHaveLength(10);
  });
});

describe("what the player reads", () => {
  it("labels a saved game with its summary", () => {
    expect(resumeLabel(session({ summary: "белые, 12-й ход" }))).toContain("12-й ход");
    expect(resumeLabel(session())).toContain("Продолжить");
  });

  it("describes when a game was last played", () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    expect(timeAgo("2026-10-31T11:59:30.000Z", now)).toBe("только что");
    expect(timeAgo("2026-10-31T11:30:00.000Z", now)).toBe("30 мин назад");
    expect(timeAgo("2026-10-31T09:00:00.000Z", now)).toBe("3 ч назад");
    expect(timeAgo("2026-10-30T12:00:00.000Z", now)).toBe("вчера");
    expect(timeAgo("2026-10-20T12:00:00.000Z", now)).toBe("11 дн назад");
  });

  it("says nothing rather than a wrong time for a broken date", () => {
    expect(timeAgo("not a date")).toBe("");
  });
});
