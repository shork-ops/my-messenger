/**
 * The bot's worker protocol.
 *
 * The point of these tests is not that the search works - `bot.test.ts` covers that - but that the
 * transport cannot corrupt a game: a reply carries the id it was asked with, a malformed message
 * gets a "no move" answer instead of killing the worker, and the same function that runs inside
 * the worker is the one used as the fallback in the main thread.
 */

import { describe, expect, it, vi } from "vitest";
import { answerRequest, installBotWorker, type WorkerRequest, type WorkerResponse } from "./worker";
import { START_FEN } from "./session";
import { isAnswerLegal } from "./bot";

function fakeScope(responses: WorkerResponse[]) {
  const scope = {
    onmessage: null as ((event: { data: WorkerRequest }) => void) | null,
    postMessage: (message: WorkerResponse) => responses.push(message),
  };
  installBotWorker(scope);
  return scope;
}

describe("the worker protocol", () => {
  it("answers with the id it was asked with", () => {
    const responses: WorkerResponse[] = [];
    const scope = fakeScope(responses);
    scope.onmessage!({ data: { id: 42, fen: START_FEN, difficulty: "normal" } });
    expect(responses).toHaveLength(1);
    // The id is what lets the screen drop an answer for a game that has already been replaced.
    expect(responses[0].id).toBe(42);
    expect(isAnswerLegal(START_FEN, responses[0].answer)).toBe(true);
  });

  it("answers a second request without confusing the two", () => {
    const responses: WorkerResponse[] = [];
    const scope = fakeScope(responses);
    scope.onmessage!({ data: { id: 1, fen: START_FEN, difficulty: "easy" } });
    scope.onmessage!({ data: { id: 2, fen: START_FEN, difficulty: "easy" } });
    expect(responses.map((response) => response.id)).toEqual([1, 2]);
  });

  it("answers rather than throws on a message it cannot use", () => {
    // An uncaught throw in a worker kills it; the screen would then wait forever for a reply.
    const responses: WorkerResponse[] = [];
    const scope = fakeScope(responses);
    expect(() =>
      scope.onmessage!({ data: { id: 7, fen: "not a fen at all", difficulty: "normal" } })
    ).not.toThrow();
    expect(responses).toHaveLength(1);
    expect(responses[0].id).toBe(7);
    expect(responses[0].answer.move).toBeNull();
    expect(responses[0].answer.reason).toBeTruthy();
  });

  it("is the same function in the main thread as in the worker", () => {
    // The fallback path is not a second implementation: it is this one, called directly.
    const direct = answerRequest({ id: 3, fen: START_FEN, difficulty: "easy" });
    expect(direct.id).toBe(3);
    expect(isAnswerLegal(START_FEN, direct.answer)).toBe(true);
  });

  it("reports no move when the position is already finished", () => {
    // Fool's mate: white is mated and has nothing to play.
    const finished = answerRequest({
      id: 9,
      fen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
      difficulty: "normal",
    });
    expect(finished.answer.move).toBeNull();
    expect(finished.answer.reason).toContain("матом");
  });
});

describe("the worker entry point", () => {
  it("installs a handler rather than searching on import", async () => {
    // Importing a module for its side effect is easy to do by accident; the entry file must only
    // install the handler, so importing the protocol must not start a search.
    const spy = vi.fn();
    const scope = { onmessage: null as ((event: { data: WorkerRequest }) => void) | null, postMessage: spy };
    installBotWorker(scope);
    expect(typeof scope.onmessage).toBe("function");
    expect(spy).not.toHaveBeenCalled();
  });
});
