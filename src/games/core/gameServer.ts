/**
 * Talking to the networked-game functions.
 *
 * Every call here mirrors one function in `supabase/migrations/20261053_networked_games.sql`, and
 * the mapping is deliberately one-to-one: if a screen needs something the server does not offer,
 * the answer is a new server function, not a cleverer query on the client. The client is not where
 * "is this my game" is decided.
 *
 * Error handling follows the same three cases as the device list, because they are the same three
 * cases: there is no connection, the migration has not been applied yet, or the server said no.
 * A screen has to tell them apart - "нет связи" and "ещё не развёрнуто" call for very different
 * words in front of a player.
 */

import { supabase } from "../../lib/supabase";
import type { GameKind } from "./types";
import type { CommitOutcome, GameNudge, ServerGame } from "./network";

/** Why a networked-game call failed, in terms the screen can act on without parsing text. */
export type NetworkError = "offline" | "not-deployed" | "refused" | "expired" | "full" | "started";

export type NetworkResult<T> = { ok: true; value: T } | { ok: false; error: NetworkError; detail?: string };

/**
 * Maps a Postgres error onto a reason.
 *
 * The distinctions followed here are the ones the migration actually raises: a missing function
 * (42883) is an undeployed feature; 42501 is either anonymity or "not your game"; P0001 with a
 * recognisable message is a game-rule refusal, which is normal and not a failure.
 */
export function classifyGameError(error: { code?: string; message?: string } | null): NetworkError {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (code === "42883" || message.includes("does not exist") || message.includes("could not find the function")) {
    return "not-deployed";
  }
  if (message.includes("expired")) return "expired";
  if (message.includes("full")) return "full";
  if (message.includes("already started")) return "started";
  if (message.includes("not a member")) return "refused";
  if (message.includes("not found")) return "refused";
  if (message.includes("authentication required") || message.includes("not your turn")) return "refused";
  if (message.includes("the game is not running")) return "refused";
  if (code === "42501" || code === "28000" || message.includes("permission denied")) return "refused";
  return "offline";
}

async function call<T>(name: string, params: Record<string, unknown>): Promise<NetworkResult<T>> {
  const client = supabase;
  if (!client) return { ok: false, error: "not-deployed" };
  try {
    const { data, error } = await client.rpc(name, params);
    if (error) return { ok: false, error: classifyGameError(error), detail: error.message };
    return { ok: true, value: data as T };
  } catch (thrown) {
    // A thrown fetch - a phone with no signal - reaches here rather than coming back as an error.
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, error: "offline", detail };
  }
}

/**
 * Opens a game and puts the caller in seat 0.
 *
 * `initialState` comes from the same engine that will draw the board, so the server does not carry a
 * second copy of the setup rules. The seed is generated here and travels inside the state; the
 * server never chooses a shuffle.
 */
export async function createServerGame(options: {
  chatId: string;
  kind: GameKind;
  seats: number;
  initialState: unknown;
  rulesVersion: number;
  dictionaryVersion?: number | null;
  dictionaryChecksum?: string | null;
}): Promise<NetworkResult<string>> {
  return call<string>("game_create", {
    p_chat: options.chatId,
    p_kind: options.kind,
    p_seats: options.seats,
    p_state: options.initialState,
    p_rules_version: options.rulesVersion,
    p_dictionary_version: options.dictionaryVersion ?? null,
    p_dictionary_checksum: options.dictionaryChecksum ?? null,
  });
}

/** Takes a free seat. Rejoining a game you are already in returns it unchanged. */
export async function joinServerGame(gameId: string): Promise<NetworkResult<ServerGame>> {
  return call<ServerGame>("game_join", { p_game: gameId });
}

/**
 * Reads one game as the caller sees it.
 *
 * This is the only way to obtain a board. The `games` table grants its columns one by one and
 * withholds `state`, so there is no query that could return somebody else's cards.
 */
export async function fetchServerGame(gameId: string): Promise<NetworkResult<ServerGame>> {
  return call<ServerGame>("game_get", { p_game: gameId });
}

/**
 * Asks the server whether this command may be applied, and gets the state to compute it from.
 *
 * Two refusals arrive as data rather than errors, because they are ordinary outcomes: `duplicate`
 * means this command already landed, `conflict` means somebody else moved first. Only a genuine
 * refusal - not your turn, not your game - comes back as an error.
 */
export async function prepareServerCommand(
  gameId: string,
  commandId: string,
  expectedRevision: number
): Promise<NetworkResult<{ status: string; revision: number; state: unknown; seat?: number; reason?: string }>> {
  return call("game_commands_prepare", {
    p_game: gameId,
    p_command_id: commandId,
    p_expected_revision: expectedRevision,
  });
}

/**
 * Writes an accepted command.
 *
 * `expectedRevision` is the revision the state was computed from, not the current one. Sending the
 * current one would defeat the check, because by then it is always right.
 */
export async function commitServerCommand(options: {
  gameId: string;
  commandId: string;
  expectedRevision: number;
  command: unknown;
  state: unknown;
  result?: unknown;
  status?: "finished" | "abandoned" | null;
}): Promise<NetworkResult<CommitOutcome>> {
  return call<CommitOutcome>("game_commands_commit", {
    p_game: options.gameId,
    p_command_id: options.commandId,
    p_expected_revision: options.expectedRevision,
    p_command: options.command,
    p_state: options.state,
    p_result: options.result ?? null,
    p_status: options.status ?? null,
  });
}

/** Leaves a game: frees the seat in a lobby, concedes a game in progress. */
export async function leaveServerGame(
  gameId: string
): Promise<NetworkResult<{ status: string; left: boolean; seatsLeft: number }>> {
  return call("game_leave", { p_game: gameId });
}

/** The games in one chat that the caller is part of. */
export async function listChatGames(chatId: string): Promise<NetworkResult<unknown[]>> {
  return call<unknown[]>("games_for_chat", { p_chat: chatId });
}

/** A fresh game with the same players, for a rematch. */
export async function rematchServerGame(gameId: string, initialState: unknown): Promise<NetworkResult<string>> {
  return call<string>("game_rematch", { p_game: gameId, p_state: initialState });
}

/**
 * Subscribes to the nudge topic for one game.
 *
 * The server publishes `{gameId, revision, status}` on `game:<id>`; it does not broadcast the row,
 * because a row change here is usually the state itself and `postgres_changes` has no per-viewer
 * projection. So the nudge is only ever a hint to re-read through `game_get`, which filters.
 *
 * Returns an unsubscribe function. A null client (no cloud configured) subscribes to nothing and
 * returns a no-op, so callers do not need to branch.
 */
export function subscribeToGame(
  gameId: string,
  onNudge: (nudge: GameNudge) => void,
  onStatus?: (status: string) => void
): () => void {
  const client = supabase;
  if (!client) return () => {};

  const channel = client
    .channel(`game:${gameId}`)
    .on("broadcast", { event: "game_revision" }, (payload) => {
      const nudge = payload?.payload as GameNudge | undefined;
      // A malformed nudge is dropped rather than trusted: it only ever causes a re-read, and a
      // re-read is exactly what a wrong one would trigger anyway.
      if (!nudge || typeof nudge.revision !== "number" || nudge.gameId !== gameId) return;
      onNudge(nudge);
    })
    .subscribe((status) => {
      onStatus?.(status);
    });

  return () => {
    void client.removeChannel(channel);
  };
}
