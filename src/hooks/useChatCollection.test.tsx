/**
 * @vitest-environment jsdom
 *
 * What the chat list leaves in the browser's storage. Cloud conversations are kept on the
 * server; a copy here would be a whole transcript that stays on a shared computer after
 * signing out, and the app never reads it back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Chat } from "../types";

const KEY = "nexus-chats-v1";

function chat(id: number, remoteId?: string): Chat {
  return {
    id,
    remoteId,
    name: `Чат ${id}`,
    avatar: "Ч",
    color: "blue",
    preview: "привет",
    time: "10:00",
    messages: [{ id: 1, author: "Аня", text: `секрет ${id}`, time: "10:00", mine: false }],
  };
}

async function load(demo: boolean) {
  vi.resetModules();
  vi.doMock("../lib/supabase", () => ({ supabase: null }));
  vi.doMock("../lib/constants", async (original) => ({
    ...(await original<typeof import("../lib/constants")>()),
    isDemoMode: demo,
    demoSeedEnabled: false,
  }));
  const { useChatCollection } = await import("./useChatCollection");
  return renderHook(() => useChatCollection({ search: "", chatFilter: "all", messageSearch: "", notify: vi.fn() }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock("../lib/constants");
  vi.doUnmock("../lib/supabase");
});

describe("chat list storage", () => {
  it("does not copy cloud conversations into the browser and clears an old copy", async () => {
    localStorage.setItem(KEY, JSON.stringify([chat(7, "old-remote")]));
    const view = await load(false);
    act(() => view.result.current.setChats([chat(1, "remote-1"), chat(2, "remote-2")]));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps chats that exist only on this device, without cloud ones mixed in", async () => {
    localStorage.setItem("nexus-demo-chats-cleared-v1", "1");
    const view = await load(true);
    act(() => view.result.current.setChats([chat(1), chat(2, "remote-2")]));
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Chat[];
    expect(saved.map((c) => c.id)).toEqual([1]);
  });
});
