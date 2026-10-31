/**
 * The bot, off the main thread.
 *
 * The search takes a few hundred milliseconds at the normal level, and that is long enough to
 * drop frames on a phone: the board would stop responding to a finger while the bot thinks. A
 * worker keeps the screen at frame rate and gives the screen a way to abandon a search it no
 * longer needs - closing the game, starting a new one, or reloading.
 *
 * The protocol is deliberately tiny and versioned by nothing: one request in, one answer out, and
 * the answer echoes the id it was asked with. A stale answer - one for a game that has already
 * been replaced - is recognised by its id and dropped, which is the failure a plain postMessage
 * race would otherwise cause: a bot move landing in the wrong game.
 *
 * This file must not import anything that touches `window` or `document`; it runs in a worker
 * scope where they do not exist. It does not read storage and does not know what a game is.
 */

import { chooseMove, type BotAnswer, type BotRequest } from "./bot";

/** What the screen sends in. */
export type WorkerRequest = {
  id: number;
  fen: string;
  difficulty: BotRequest["difficulty"];
};

/** What the worker sends back. The id is the request's own, so the caller can discard stale ones. */
export type WorkerResponse = { id: number; answer: BotAnswer };

/**
 * Answers one request.
 *
 * Exported and free of worker globals so the same function can be called in the main thread as a
 * fallback where workers are unavailable - an old browser, or a test environment. A bot that
 * exists only inside a worker would make the game unplayable exactly where the platform is
 * weakest.
 */
export function answerRequest(request: { id: number; fen: string; difficulty: BotRequest["difficulty"] }): WorkerResponse {
  return {
    id: request.id,
    answer: chooseMove({ fen: request.fen, difficulty: request.difficulty }),
  };
}

/** The slice of the worker scope this module uses, so it can be typed without DOM or webworker libs. */
type WorkerScope = {
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

/**
 * Installs the message handler.
 *
 * Called by the entry file rather than at import time: importing a module for its side effect is
 * easy to do by accident, and here it would start answering messages in whatever context imported
 * it.
 */
export function installBotWorker(scope: WorkerScope): void {
  scope.onmessage = (event) => {
    const request = event.data;
    // A malformed message is answered with no move rather than an exception: an uncaught throw in
    // a worker kills it, and the game would then hang waiting for an answer that never comes.
    try {
      scope.postMessage(answerRequest(request));
    } catch (error) {
      scope.postMessage({
        id: request?.id ?? 0,
        answer: {
          move: null,
          score: 0,
          depth: 0,
          nodes: 0,
          stopped: false,
          reason: "Бот не смог обдумать ход",
        },
      });
      void error;
    }
  };
}
