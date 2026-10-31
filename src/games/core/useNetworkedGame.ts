/**
 * One networked game, from this account's seat.
 *
 * Kept apart from `useGameSessions` on purpose. Bot and same-device play are finished, tested, and
 * work with no server at all; networked play needs an account, a connection, and a subscription.
 * Folding the two together would put a network round trip in the path of a bot move and make the
 * failure modes of one apply to the other.
 *
 * The hook's job is narrow: hold the latest game the server has, follow the nudge topic, and send
 * commands. The rules stay in the engines. If this file ever grows a legality check, the split has
 * been lost.
 *
 * What it handles that a single-device game never had to:
 *
 * - **Reconnect.** A phone that slept loses realtime. On waking, the hook re-reads unconditionally,
 *   because a missed nudge is indistinguishable from no move having happened.
 * - **Conflict.** If a command was computed from a revision that has since moved, the server refuses
 *   it and returns the board it actually holds. That board replaces the local one - the player sees
 *   what happened rather than their own version of it.
 * - **Stale async.** Every fetch carries a generation number; a slow response for a game the player
 *   has already left is dropped instead of overwriting the new one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  myTurn,
  newCommandId,
  nextStepFor,
  nudgeAdvances,
  NETWORK_TEXT,
  type GameNudge,
  type ServerGame,
} from "./network";
import {
  commitServerCommand,
  fetchServerGame,
  joinServerGame,
  leaveServerGame,
  prepareServerCommand,
  rematchServerGame,
  subscribeToGame,
  type NetworkError,
} from "./gameServer";

/** What the screen should be showing. */
export type NetworkedGameState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable"; error: NetworkError }
  | { kind: "ready"; game: ServerGame; sending: boolean; note: string | null };

export type UseNetworkedGame = {
  state: NetworkedGameState;
  /** The game, when there is one. Convenience for rendering. */
  game: ServerGame | null;
  /** Whether the person at this screen may act right now. */
  canAct: boolean;
  join: (gameId: string) => Promise<void>;
  /** Runs one action through the engine's command path and sends it. */
  send: (command: unknown, nextState?: unknown, result?: unknown) => Promise<void>;
  /** Re-reads the game. Used after a reconnect, and after a conflict was reported. */
  refresh: () => Promise<void>;
  rematch: (initialState: unknown) => Promise<string | null>;
  leave: () => Promise<void>;
  reset: () => void;
};

const REFRESH_ON_WAKE_MS = 400;

export function useNetworkedGame(accountId: string | null, gameId: string | null): UseNetworkedGame {
  const [state, setState] = useState<NetworkedGameState>({ kind: "idle" });
  // Responses are matched against this, so a slow fetch for a game the player already left cannot
  // overwrite the one they are looking at.
  const generation = useRef(0);
  // The revision each command was computed from, so a retry reuses it rather than the current one.
  const pendingCommand = useRef<{ commandId: string; revision: number } | null>(null);

  const adopt = useCallback((game: ServerGame, generationAtStart: number) => {
    if (generationAtStart !== generation.current) return;
    setState((current) => ({
      kind: "ready",
      game,
      sending: current.kind === "ready" ? current.sending : false,
      note: current.kind === "ready" ? current.note : null,
    }));
  }, []);

  const fail = useCallback((error: NetworkError, generationAtStart: number) => {
    if (generationAtStart !== generation.current) return;
    setState({ kind: "unavailable", error });
  }, []);

  /** Reads the game and adopts it. `silent` keeps the board on screen instead of blanking it. */
  const load = useCallback(
    async (id: string, silent: boolean) => {
      const mine = generation.current;
      if (!silent) setState({ kind: "loading" });
      const result = await fetchServerGame(id);
      if (result.ok) {
        adopt(result.value, mine);
        return;
      }
      // A silent refresh that fails leaves what is on screen alone: losing a signal is not a reason
      // to blank a board the player is looking at. The next nudge or wake will try again.
      if (silent) return;
      fail(result.error, mine);
    },
    [adopt, fail]
  );

  const reset = useCallback(() => {
    generation.current += 1;
    pendingCommand.current = null;
    setState({ kind: "idle" });
  }, []);

  const join = useCallback(
    async (id: string) => {
      generation.current += 1;
      const mine = generation.current;
      setState({ kind: "loading" });
      const result = await joinServerGame(id);
      if (result.ok) {
        adopt(result.value, mine);
        return;
      }
      fail(result.error, mine);
    },
    [adopt, fail]
  );

  // Load when a game is chosen, and follow it until the screen lets go of it.
  useEffect(() => {
    if (!accountId || !gameId) {
      reset();
      return;
    }
    generation.current += 1;
    const mine = generation.current;
    setState({ kind: "loading" });
    void fetchServerGame(gameId).then((result) => {
      if (result.ok) adopt(result.value, mine);
      else fail(result.error, mine);
    });
    return () => {
      // Bumping the generation in cleanup kills any response still in flight for this game.
      generation.current += 1;
    };
  }, [accountId, gameId, adopt, fail, reset]);

  // The nudge topic. It carries a revision and nothing else; the board is re-read through the
  // filtering function, never taken from the payload.
  useEffect(() => {
    if (!accountId || !gameId) return;
    return subscribeToGame(gameId, (nudge: GameNudge) => {
      setState((current) => {
        if (current.kind !== "ready") return current;
        if (!nudgeAdvances(nudge, current.game.revision, current.game.id)) return current;
        return current;
      });
      // Re-read whenever the nudge says something changed. The guard above only decides whether to
      // bother; the fetch itself is what makes the board correct.
      void load(gameId, true);
    });
  }, [accountId, gameId, load]);

  // Coming back from sleep or a dropped connection. Realtime does not replay missed messages, so
  // the only correct thing to do on wake is re-read - a missed nudge and "nothing happened" look
  // identical from here.
  useEffect(() => {
    if (!accountId || !gameId || typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Captured once: the effect already returned early unless `gameId` is set, and the closures
    // below must not depend on the narrowing still holding after an await.
    const tracked = gameId;
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      // A short debounce: a phone can flap visibility on the way out of the lock screen.
      timer = setTimeout(() => void load(tracked, true), REFRESH_ON_WAKE_MS);
    }
    function onOnline() {
      void load(tracked, true);
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [accountId, gameId, load]);

  const refresh = useCallback(async () => {
    if (!gameId) return;
    await load(gameId, true);
  }, [gameId, load]);

  const send = useCallback(
    async (command: unknown, nextState?: unknown, result?: unknown) => {
      if (!gameId) return;
      const current = state;
      if (current.kind !== "ready") return;
      if (current.game.mySeat === null) return;

      // One command id per attempt, reused if the same attempt is retried. The server treats a
      // repeated id as the same move, which is what makes a retry safe after a timeout.
      const commandId = newCommandId();
      const expectedRevision = current.game.revision;
      pendingCommand.current = { commandId, revision: expectedRevision };

      setState({ ...current, sending: true, note: null });

      // Prepare first: it is where the server decides authorship, turn order and staleness. A
      // conflict here is the common race and is handled as a normal answer, not an error.
      const prepared = await prepareServerCommand(gameId, commandId, expectedRevision);
      if (!prepared.ok) {
        setState({
          kind: "ready",
          game: current.game,
          sending: false,
          note: prepared.error === "refused" ? NETWORK_TEXT.notYourTurn : NETWORK_TEXT.refused,
        });
        return;
      }
      if (prepared.value.status === "conflict") {
        // Somebody else moved first. Adopt their board and say so, rather than pretending the move
        // happened or silently dropping it.
        await load(gameId, true);
        setState((now) => (now.kind === "ready" ? { ...now, note: NETWORK_TEXT.conflict } : now));
        return;
      }
      if (prepared.value.status === "duplicate") {
        await load(gameId, true);
        return;
      }

      // The state to write.
      //
      // The caller passes `nextState` for the board games: it ran the engine on exactly the state the
      // server handed back a moment ago. If it did not pass one, the server's current state is the
      // only defensible fallback for a board game - but that means "no change", so it is better to
      // refuse than to write a board nobody moved.
      const boardState = nextState ?? (current.game.view.kind === "open" ? current.game.view.state : undefined);
      if (boardState === undefined) {
        setState({ kind: "ready", game: current.game, sending: false, note: NETWORK_TEXT.refused });
        return;
      }

      const committed = await commitServerCommand({
        gameId,
        commandId,
        expectedRevision,
        command,
        state: boardState,
        result: result ?? null,
      });
      if (!committed.ok) {
        setState({ kind: "ready", game: current.game, sending: false, note: NETWORK_TEXT.offline });
        return;
      }

      const step = nextStepFor(committed.value);
      if (step.kind === "reread") {
        await load(gameId, true);
        setState((now) => (now.kind === "ready" ? { ...now, note: step.reason } : now));
        return;
      }
      pendingCommand.current = null;
      // A duplicate means the retry landed; either way the authoritative board is a re-read, because
      // the commit response carries the raw state and the screen renders the filtered view.
      await load(gameId, true);
      setState((now) => (now.kind === "ready" ? { ...now, sending: false } : now));
    },
    [gameId, state, load]
  );

  const rematch = useCallback(
    async (initialState: unknown) => {
      const current = state;
      if (current.kind !== "ready") return null;
      const result = await rematchServerGame(current.game.id, initialState);
      if (!result.ok) return null;
      return result.value;
    },
    [state]
  );

  const leave = useCallback(async () => {
    const current = state;
    if (current.kind !== "ready") return;
    await leaveServerGame(current.game.id);
    reset();
  }, [state, reset]);

  // `canAct` is derived rather than stored, so it can never disagree with the board on screen.
  const canAct = state.kind === "ready" ? myTurn(state.game) : false;

  return {
    state,
    game: state.kind === "ready" ? state.game : null,
    canAct,
    join,
    send,
    refresh,
    rematch,
    leave,
    reset,
  };
}
