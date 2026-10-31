/**
 * Saved games.
 *
 * The plan is explicit about the thing that was wrong before: closing a game threw it away, so
 * a player who was in the middle of a position had no way back to it. Everything here exists to
 * make one promise - what you left is what you find.
 *
 * A saved game carries the dictionary and rules versions it was created with. That is not
 * bookkeeping: a chess game saved under one rule set and reopened under another can silently
 * become a different game, and the fair answer is to keep the old rules rather than reinterpret
 * a position the player already committed to.
 */

import type { GameKind, GameStatus, PlayMode } from "../core/types";

export const STORAGE_KEY = "nexus.games.sessions";

/**
 * Bumped whenever the saved shape changes in a way an older save cannot satisfy. A save with a
 * different number is discarded rather than guessed at.
 */
export const STORAGE_VERSION = 1;

export type SavedSession = {
  gameId: string;
  kind: GameKind;
  /** Which rule set the game was started with; a resumed game keeps it. */
  rulesVersion: number;
  /** Which dictionary the words are checked against, for «Балда». */
  dictionaryVersion: number;
  mode: PlayMode;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
  /** A short line for the catalogue card, written when the game is saved. */
  summary: string;
  /** Opaque to the storage layer: the engine's own state, exactly as it left it. */
  state: unknown;
};

export type GameStorage = {
  read(): SavedSession[];
  write(sessions: SavedSession[]): void;
};

/**
 * The storage a browser gets.
 *
 * Every call is guarded: `localStorage` throws in a private window on some browsers and when the
 * quota is full, and a game that cannot be saved must still be playable rather than crashing
 * the screen it is drawn on.
 */
export function browserStorage(): GameStorage {
  return {
    read() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isSavedSession);
      } catch {
        // Corrupt or unreadable: start clean rather than break the games screen.
        return [];
      }
    },
    write(sessions) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      } catch {
        // Quota or a blocked storage: the game keeps running in memory.
      }
    },
  };
}

/** A storage that forgets everything, for tests and for the first render on the server. */
export function memoryStorage(initial: SavedSession[] = []): GameStorage & { current(): SavedSession[] } {
  let sessions = initial.slice();
  return {
    read: () => sessions.slice(),
    write: (next) => {
      sessions = next.slice();
    },
    current: () => sessions.slice(),
  };
}

const KINDS: GameKind[] = ["chess", "cards", "balda"];
const MODES: PlayMode[] = ["bot", "local", "friend"];
const STATUSES: GameStatus[] = ["playing", "finished", "abandoned"];

function isSavedSession(value: unknown): value is SavedSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.gameId === "string" &&
    candidate.gameId.length > 0 &&
    typeof candidate.kind === "string" &&
    KINDS.includes(candidate.kind as GameKind) &&
    typeof candidate.rulesVersion === "number" &&
    typeof candidate.dictionaryVersion === "number" &&
    typeof candidate.mode === "string" &&
    MODES.includes(candidate.mode as PlayMode) &&
    typeof candidate.status === "string" &&
    STATUSES.includes(candidate.status as GameStatus) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.summary === "string" &&
    candidate.state !== undefined
  );
}

/**
 * Whether a saved game can be resumed as it stands.
 *
 * A save whose rules or dictionary version no longer matches the running build is not resumed:
 * the words already played would be checked against a different dictionary, and a player would
 * be told their own earlier word is invalid.
 */
export function canResume(session: SavedSession, rulesVersion: number, dictionaryVersion: number): boolean {
  if (session.status !== "playing") return false;
  if (session.rulesVersion !== rulesVersion) return false;
  if (session.dictionaryVersion !== dictionaryVersion) return false;
  return true;
}

/** The open game of each kind, so the catalogue can show «Продолжить» instead of «Играть». */
export function unfinishedByKind(sessions: SavedSession[]): Partial<Record<GameKind, SavedSession>> {
  const out: Partial<Record<GameKind, SavedSession>> = {};
  for (const session of sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    if (session.status !== "playing") continue;
    if (!out[session.kind]) out[session.kind] = session;
  }
  return out;
}

/** Adds or replaces one session, keeping the list ordered by most recent activity. */
export function upsertSession(sessions: SavedSession[], session: SavedSession): SavedSession[] {
  const without = sessions.filter((existing) => existing.gameId !== session.gameId);
  return [session, ...without].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Removes a saved game, for the player who is done with it. */
export function removeSession(sessions: SavedSession[], gameId: string): SavedSession[] {
  return sessions.filter((session) => session.gameId !== gameId);
}

/**
 * Keeps the newest `limit` finished games and every unfinished one.
 *
 * Without this the storage grows until the quota throws, and the throw is swallowed - which
 * means saving quietly stops working for everyone, much later, with no clue why.
 */
export function prune(sessions: SavedSession[], limit = 20): SavedSession[] {
  const active = sessions.filter((session) => session.status === "playing");
  const done = sessions.filter((session) => session.status !== "playing").slice(0, limit);
  return [...active, ...done];
}

/** The label the catalogue shows for a saved game. */
export function resumeLabel(session: SavedSession): string {
  return `Продолжить · ${session.summary}`;
}

/** How long ago a game was touched, in words rather than a timestamp. */
export function timeAgo(iso: string, now = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "только что";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "вчера";
  if (days < 30) return `${days} дн назад`;
  return then.toLocaleDateString("ru-RU");
}
