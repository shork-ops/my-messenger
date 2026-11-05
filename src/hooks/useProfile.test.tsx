/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn(), upsert: vi.fn(), getUser: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: mock.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mock.read }) }), upsert: mock.upsert }),
  },
}));
vi.mock("../lib/profileDetails", () => ({ fetchProfileDetails: async () => new Map() }));
import { useProfile } from "./useProfile";
const notify = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.clearAllMocks();
  mock.getUser.mockResolvedValue({
    data: { user: { id: "owner", email: "qa@example.invalid", user_metadata: {} } },
  });
  mock.upsert.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("keeps the account on a transient profile error and recovers without a page reload", async () => {
  mock.read
    .mockResolvedValueOnce({ error: { message: "Failed to fetch" } })
    .mockResolvedValue({ data: { display_name: "QA", avatar: "Q", username: "qa" }, error: null });
  const { result } = renderHook(() => useProfile({ notify }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current.accountId).toBe("owner");
  expect(result.current.profileReady).toBe(false);
  expect(result.current.profileLoadStatus).toBe("error");
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current.accountId).toBe("owner");
  expect(result.current.profileReady).toBe(true);
  expect(result.current.profileLoadStatus).toBe("ready");
  expect(result.current.profileName).toBe("QA");
  expect(mock.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: "owner", display_name: "QA" }));
});
