/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Chat } from "../types";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("../lib/constants", async (original) => ({ ...(await original<typeof import("../lib/constants")>()), demoSeedEnabled: false }));

import { useStreaks } from "./useStreaks";
// Loaded up front, so the hook's own import() of it resolves within the fake clock.
import "../lib/streakEngine";

const chat = (id: number, remoteId: string, lastMessageId: number, extra: Partial<Chat> = {}): Chat =>
  ({
    id,
    remoteId,
    name: `Чат ${id}`,
    avatar: "",
    color: "blue",
    preview: "",
    time: "",
    messages: [{ id: lastMessageId, author: "", text: "", time: "" }],
    ...extra,
  }) as Chat;

const answer = (rows: unknown[]) => Promise.resolve({ data: rows, error: null });
const streakRow = (chatId: string, lastFull: string, run: number) => ({
  chat_id: chatId,
  last_full: lastFull,
  run_days: run,
  record_days: run,
  today: "2026-11-01",
  today_mine: true,
  today_theirs: lastFull === "2026-11-01",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 1, 12, 0, 0));
  window.localStorage.clear();
  rpc.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function settle() {
  // The request waits a moment; the reading of its answer is a chunk loaded after it.
  for (let step = 0; step < 3; step += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  }
}

describe("useStreaks", () => {
  it("asks the server in the reader's time zone and keeps direct chats only", async () => {
    rpc.mockReturnValue(answer([streakRow("r1", "2026-10-31", 6), streakRow("g", "2026-11-01", 9)]));
    const chats = [chat(1, "r1", 10), chat(2, "g", 20, { group: true })];
    const { result } = renderHook(() => useStreaks(chats, "me", () => {}));
    await settle();
    expect(rpc).toHaveBeenCalledWith("my_streaks", { p_tz: expect.any(String) });
    expect(result.current.streaks.get(1)).toMatchObject({ text: "🔥6", pending: true, shown: true });
    expect(result.current.streaks.get(1)?.streak).toMatchObject({ days: 6, alive: true, todayDone: false });
    expect(result.current.streaks.has(2)).toBe(false);
  });

  it("shows nothing, and does not complain, before the migration is applied", async () => {
    rpc.mockReturnValue(Promise.resolve({ data: null, error: { message: "function my_streaks does not exist" } }));
    const notify = vi.fn();
    const { result } = renderHook(() => useStreaks([chat(1, "r1", 10)], "me", notify));
    await settle();
    expect(result.current.streaks.size).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("celebrates a level reached while watching, once, and not one that was already there", async () => {
    rpc.mockReturnValue(answer([streakRow("r1", "2026-10-31", 6)]));
    const notify = vi.fn();
    let chats = [chat(1, "r1", 10, { name: "Максим" })];
    const { result, rerender } = renderHook(() => useStreaks(chats, "me", notify));
    await settle();
    expect(notify).not.toHaveBeenCalled();

    // A new message: asked again, and today now counts.
    rpc.mockReturnValue(answer([streakRow("r1", "2026-11-01", 7)]));
    chats = [chat(1, "r1", 11, { name: "Максим" })];
    rerender();
    await settle();
    expect(notify).toHaveBeenCalledWith("🏕️ Костёр! 7 дней подряд в чате «Максим»");
    expect(result.current.burstId).toBe(1);

    chats = [chat(1, "r1", 12, { name: "Максим" })];
    rerender();
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.burstId).toBeNull();
  });

  it("does not ask without an account", async () => {
    renderHook(() => useStreaks([chat(1, "r1", 10)], null, () => {}));
    await settle();
    expect(rpc).not.toHaveBeenCalled();
  });
});
