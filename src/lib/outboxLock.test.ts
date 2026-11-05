/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { withOutboxLock } from "./outboxLock";
afterEach(() => {
  Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
});
it("uses UUID idempotency when the browser rejects lock acquisition", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: vi.fn().mockRejectedValue(new DOMException("blocked", "SecurityError")) },
  });
  const run = vi.fn().mockResolvedValue(undefined);
  await withOutboxLock("qa", run);
  expect(run).toHaveBeenCalledTimes(1);
});
it("never repeats a worker that already started and failed inside the lock", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_name: unknown, _options: unknown, callback: (lock: object) => Promise<void>) =>
        callback({}),
    },
  });
  const run = vi.fn().mockRejectedValue(new Error("worker error"));
  await expect(withOutboxLock("qa", run)).rejects.toThrow("worker error");
  expect(run).toHaveBeenCalledTimes(1);
});
it("lets another tab finish its active worker", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_name: unknown, _options: unknown, callback: (lock: null) => Promise<void>) =>
        callback(null),
    },
  });
  const run = vi.fn();
  await withOutboxLock("qa", run);
  expect(run).not.toHaveBeenCalled();
});
