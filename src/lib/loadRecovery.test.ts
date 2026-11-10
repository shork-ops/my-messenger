/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recoverLoad } from "./loadRecovery";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("retries immediately on focus after a failure and removes the listener on disposal", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const recovery = recoverLoad(load, () => {});
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event("focus"));
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(0);
  recovery.dispose();
  window.dispatchEvent(new Event("focus"));
  expect(load).toHaveBeenCalledTimes(2);
});
it("retries a failed read on reconnect without overlapping requests", async () => {
  let finish: () => void = () => {};
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  const statuses: string[] = [];
  const recovery = recoverLoad(load, (value) => statuses.push(value));
  await vi.advanceTimersByTimeAsync(0);
  expect(statuses).toEqual(["loading", "error"]);
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("online"));
  expect(load).toHaveBeenCalledTimes(2);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(statuses[statuses.length - 1]).toBe("ready");
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(2);
  recovery.dispose();
});
it("backs off repeated failures and cancels timers/listeners on disposal", async () => {
  const load = vi.fn().mockRejectedValue(new Error("offline"));
  const statuses = vi.fn();
  const recovery = recoverLoad(load, statuses);
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1999);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(3);
  recovery.dispose();
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(3);
});
