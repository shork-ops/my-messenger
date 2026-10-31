/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { sign } = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { storage: { from: () => ({ createSignedUrl: sign }) } } }));
import { clearAvatarCache, useAvatarUrl } from "./useAvatarUrl";
beforeEach(() => { vi.useFakeTimers(); sign.mockReset(); clearAvatarCache(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shares signing requests and refreshes before the one-hour expiry", async () => {
  sign.mockResolvedValueOnce({ data: { signedUrl: "first" } }).mockResolvedValue({ data: { signedUrl: "renewed" } });
  const first = renderHook(() => useAvatarUrl("peer/photo.jpg"));
  const second = renderHook(() => useAvatarUrl("peer/photo.jpg"));
  await act(async () => { await Promise.resolve(); });
  expect(first.result.current).toBe("first");
  expect(second.result.current).toBe("first");
  expect(sign).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(54 * 60_000); });
  expect(first.result.current).toBe("renewed");
  expect(sign).toHaveBeenCalledTimes(2);
});

it("does not display the previous peer's photo while resolving a new path", async () => {
  sign.mockResolvedValueOnce({ data: { signedUrl: "old" } });
  const { result, rerender } = renderHook(({ path }) => useAvatarUrl(path), { initialProps: { path: "a/photo.jpg" } });
  await act(async () => { await Promise.resolve(); });
  expect(result.current).toBe("old");
  sign.mockReturnValue(new Promise(() => {}));
  rerender({ path: "b/photo.jpg" });
  expect(result.current).toBeNull();
});
