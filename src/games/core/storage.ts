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
 *
 * The second promise is quieter but harder: your games are yours. Saves live under a key for the
 * signed-in account, so two people sharing a phone neither see nor overwrite each other's games.
 */

import type { GameKind, GameStatus, PlayMode } from "../core/types";

export const STORAGE_KEY = "nexus.games.sessions";

/**
 * One key per account.
 *
 * Games used to share a single key for the whole browser, so on a shared phone two people saw
 * each other's position - and worse, the second player's save silently replaced the first one's.
 * The account id is the only stable identity the app has, and scoping the key by it is enough for
 * the promise this file makes. Guest play gets its own key rather than the bare legacy key, so a
 * guest can never overwrite a real account's games.
 */
export function storageKeyFor(accountId: string | null): string {
  return `${STORAGE_KEY}:${accountId ?? "guest"}`;
}

/**
 * Where saves lived before games belonged to an account. The key is kept exactly as it was, so a
 * player who had a game in progress before this change is not silently robbed of it: the first
 * account to open the games screen adopts that list and the old key is cleared.
 */
export const LEGACY_STORAGE_KEY = STORAGE_KEY;

/**
 * Bumped whenever the saved shape changes in a way an older save cannot satisfy. A save with a
 * different number is discarded rather than guessed at.
 *
 * Version 2 moved saves under a per-account key. Version-1 saves are not discarded; they are
 * adopted once, by `takeLegacySessions`, so the bump does not cost anyone their game.
 */
export const STORAGE_VERSION = 2;

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
export function browserStorage(accountId: string | null = null): GameStorage {
  const key = storageKeyFor(accountId);
  return {
    read() {
      try {
        const raw = window.localStorage.getItem(key);
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
        window.localStorage.setItem(key, JSON.stringify(sessions));
      } catch {
        // Quota or a blocked storage: the game keeps running in memory.
      }
    },
  };
}

/**
 * Adopts the saves made before games were per-account — but only when they prove whose they are.
 *
 * This used to give the legacy list to the first account that opened the games screen. That is
 * exactly the attribution the isolation work forbids: on a shared phone, the second person to
 * sign in would inherit the first person's game in progress and the first person's key would be
 * emptied. Losing that attribution is a real cost, and the honest trade is to keep the games where
 * they are, unread, and say so, rather than to hand them to a plausible owner.
 *
 * A legacy save can prove its owner two ways, both recorded by the build that wrote it:
 *
 * - the save names the account in a `playerId`/`ownerId`/`accountId` field, or
 * - every save in the list was made in a mode that has no account at all (`bot`, `local`), in
 *   which case nobody's private data is at stake and the guest namespace may take it.
 *
 * Anything else is left in place. The key is only cleared when an adoption actually happened.
 */
export function takeLegacySessions(accountId: string | null): SavedSession[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage is unreadable at all; there is nothing to adopt and nothing to clean up.
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt value is not going to become readable on the next visit, and leaving it would
    // make every visit pay for the same parse failure.
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Nothing to do.
    }
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const sessions = parsed.filter(isSavedSession);
  if (sessions.length === 0) return [];

  if (!accountId) {
    // A guest may only take games that never belonged to an account in the first place: a shared
    // phone must not hand a visitor an account-holder's position.
    if (!sessions.every(isAccountlessSession)) return [];
  } else if (!sessions.every((session) => legacyOwnerOf(session) === accountId)) {
    // Either the owner is unrecorded, or it is somebody else. Both mean "not mine".
    return [];
  }

  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Nothing to do: the removal failing is not a reason to lose the games being read below.
  }
  return sessions;
}

/** The account a legacy save names, if it names one. */
function legacyOwnerOf(session: SavedSession): string | null {
  const candidate = (session as SavedSession & Record<string, unknown>).ownerId ??
    (session as SavedSession & Record<string, unknown>).accountId ??
    (session as SavedSession & Record<string, unknown>).playerId;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim().toLowerCase() : null;
}

/**
 * Whether a save could only ever have been made without an account.
 *
 * Bot and same-device games record no account because there is none to record; they are not
 * somebody's private conversation, so adopting them as a guest loses nothing.
 */
function isAccountlessSession(session: SavedSession): boolean {
  return legacyOwnerOf(session) === null && (session.mode === "bot" || session.mode === "local");
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
