/**
 * @vitest-environment jsdom
 *
 * The screen half of disappearing messages: a bubble leaves at its deadline rather than at
 * the next reload, and a timer chosen for a chat on this device times the messages after it.
 * In a cloud chat the server is the authority; that half is checked in
 * scripts/check-disappearing.mjs against a real PostgreSQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useDisappearingMessages } from "./useDisappearingMessages";
import type { Chat } from "../types";

vi.mock("../lib/supabase", () => ({ supabase: null }));

const START = 1_800_000_000_000;

async function setup(initial: Chat[]) {
  const notify = vi.fn();
  const view = renderHook(() => {
    const [chats, setChats] = useState(initial);
    const timer = useDisappearingMessages({ accountId: null, chats, setChats, notify });
    return { chats, setChats, timer };
  });
  // The rules load right after the first screen; wait for them as the app would.
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return { view, notify };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDisappearingMessages", () => {
  it("removes a message at its deadline, not before", async () => {
    const { view } = await setup([
      {
        id: 1, name: "Аня", avatar: "А", color: "blue", preview: "скоро исчезнет", time: "12:01",
        messages: [
          { id: 1, author: "Аня", text: "останется", time: "12:00", createdAt: START - 60_000 },
          { id: 2, author: "Аня", text: "скоро исчезнет", time: "12:01", createdAt: START, disappearsAt: START + 5000 },
        ],
      },
    ]);
    act(() => void vi.advanceTimersByTime(4999));
    expect(view.result.current.chats[0].messages).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(1));
    expect(view.result.current.chats[0].messages.map((message) => message.text)).toEqual(["останется"]);
    expect(view.result.current.chats[0].preview).toBe("останется");
  });

  it("waits past the longest single timer the browser allows", async () => {
    const week = 7 * 24 * 3600_000;
    const { view } = await setup([
      {
        id: 1, name: "Аня", avatar: "А", color: "blue", preview: "", time: "",
        messages: [{ id: 1, author: "Аня", text: "через неделю", time: "12:00", createdAt: START, disappearsAt: START + week }],
      },
    ]);
    act(() => void vi.advanceTimersByTime(week - 3600_000));
    expect(view.result.current.chats[0].messages).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(3600_000));
    expect(view.result.current.chats[0].messages).toHaveLength(0);
  });

  it("switches a timer on for a chat on this device and times only what comes after", async () => {
    const { view, notify } = await setup([
      {
        id: 7, name: "Заметки", avatar: "З", color: "blue", preview: "", time: "",
        messages: [{ id: 1, author: "Я", text: "старое", time: "11:00", mine: true, createdAt: START - 3600_000 }],
      },
    ]);
    act(() => view.result.current.timer.openTimer(7));
    expect(view.result.current.timer.timerChatId).toBe(7);
    await act(async () => view.result.current.timer.applyTimer(3600));
    expect(view.result.current.timer.timerChatId).toBeNull();
    expect(view.result.current.chats[0].messageTtlSeconds).toBe(3600);
    expect(notify).toHaveBeenCalledWith("Исчезающие сообщения: 1 час");

    act(() => {
      view.result.current.setChats((chats) => [
        { ...chats[0], messages: [...chats[0].messages, { id: 2, author: "Я", text: "новое", time: "12:00", mine: true, createdAt: START + 1000 }] },
      ]);
    });
    const [old, fresh] = view.result.current.chats[0].messages;
    expect(old.disappearsAt).toBeUndefined();
    expect(fresh.disappearsAt).toBe(START + 1000 + 3600_000);

    act(() => void vi.advanceTimersByTime(3600_000 + 1000));
    expect(view.result.current.chats[0].messages.map((message) => message.text)).toEqual(["старое"]);
  });
});
