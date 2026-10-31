/**
 * Asking the bot for a move, cancellably.
 *
 * The screen needs three things from the bot that a plain function call cannot give: it must not
 * block drawing, its answer must not arrive after the game it was thinking about is gone, and a
 * search must be abandonable. This hook is the only place that knows about those three, so no game
 * screen has to.
 *
 * The fallback matters as much as the worker: where `Worker` is missing - an old browser, a
 * locked-down webview, the test environment - the same request is answered in the current thread.
 * That blocks for a few hundred milliseconds instead of never answering, which is the right trade
 * for a player who would otherwise have a bot that does not move.
 */

import { useCallback, useEffect, useRef } from "react";
import type { BotAnswer } from "./bot";
import { answerRequest, type WorkerRequest, type WorkerResponse } from "./worker";

/** Whether this environment can run the search off the main thread. */
export function canUseWorker(): boolean {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

/** Creates the worker, or returns null where one cannot be created. */
function createWorker(): Worker | null {
  if (!canUseWorker()) return null;
  try {
    return new Worker(new URL("./bot.worker.ts", import.meta.url), { type: "module" });
  } catch {
    // A worker that cannot be created must not take the game down with it.
    return null;
  }
}

export type BotRunner = {
  /** Asks for a move. Any search already running is abandoned first. */
  request: (fen: string, difficulty: WorkerRequest["difficulty"]) => Promise<BotAnswer | null>;
  /** Abandons the search in flight, if any. The promise for it resolves with null. */
  cancel: () => void;
};

/**
 * The bot, as a cancellable service.
 *
 * `request` resolves with null when the search was cancelled or superseded; callers treat null as
 * "no move" rather than as an error, because a cancelled search is a normal event (the player
 * closed the screen), not a failure.
 */
export function useChessBot(): BotRunner {
  const workerRef = useRef<Worker | null>(null);
  const nextIdRef = useRef(0);
  const pendingRef = useRef<{
    id: number;
    resolve: (answer: BotAnswer | null) => void;
  } | null>(null);

  // One worker for the life of the screen: creating one per move would pay its start-up each time.
  useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    if (!worker) return;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = pendingRef.current;
      // A reply for a search that has already been abandoned is dropped: applying it would make
      // the bot move in a game the player has already left.
      if (!pending || pending.id !== event.data.id) return;
      pendingRef.current = null;
      pending.resolve(event.data.answer);
    };
    worker.onerror = () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      pending?.resolve(null);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      pending?.resolve(null);
    };
  }, []);

  const cancel = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    pending.resolve(null);
    // The search itself is stopped by terminating the worker: a cancelled search cannot be told
    // to stop from outside a worker, and terminating is what guarantees the CPU is released
    // rather than left thinking about a game nobody is watching.
    const worker = workerRef.current;
    if (worker) {
      worker.terminate();
      const replacement = createWorker();
      workerRef.current = replacement;
      if (replacement) {
        replacement.onmessage = worker.onmessage;
        replacement.onerror = worker.onerror;
      }
    }
  }, []);

  const request = useCallback(
    (fen: string, difficulty: WorkerRequest["difficulty"]): Promise<BotAnswer | null> => {
      cancel();
      nextIdRef.current += 1;
      const id = nextIdRef.current;
      const worker = workerRef.current;
      if (!worker) {
        // No worker available: answer here and now. The result is still checked for legality by
        // the caller before it is applied, so a slow answer cannot become a wrong one.
        return Promise.resolve(answerRequest({ id, fen, difficulty }).answer);
      }
      return new Promise<BotAnswer | null>((resolve) => {
        pendingRef.current = { id, resolve };
        worker.postMessage({ id, fen, difficulty } satisfies WorkerRequest);
      });
    },
    [cancel]
  );

  return { request, cancel };
}
