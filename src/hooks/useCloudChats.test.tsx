/** @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Chat } from "../types";
const mock = vi.hoisted(() => ({ membership: vi.fn(), page: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        const result = () =>
          table === "chat_members" && columns.includes("muted_until")
            ? mock.membership()
            : Promise.resolve({
                data:
                  table === "chats"
                    ? [{ id: "remote", title: "Peer", is_group: false }]
                    : table === "chat_members"
                      ? [
                          { chat_id: "remote", user_id: "owner" },
                          { chat_id: "remote", user_id: "peer" },
                        ]
                      : [{ id: "peer", display_name: "Peer" }],
                error: null,
              });
        const query = {
          eq: () => query,
          in: () => query,
          order: () => query,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            result().then(resolve, reject),
        };
        return query;
      },
    }),
  },
}));
vi.mock("../lib/messageLoader", () => ({ DEFAULT_MESSAGE_PAGE_SIZE: 50, loadMessagePage: mock.page }));
vi.mock("../lib/messageSync", () => ({ fetchReactions: async () => ({}) }));
vi.mock("../lib/profileDetails", () => ({
  fetchProfileDetails: async () => new Map(),
  fetchLastSeen: async () => new Map(),
}));
vi.mock("../lib/savedMessages", () => ({ loadSavedMessages: async () => [], mergeFavourites: () => null }));
vi.mock("../lib/disappearingLive", () => ({ fetchChatTimers: async () => new Map() }));
import { useCloudChats } from "./useCloudChats";
const existing: Chat = {
  id: 1,
  remoteId: "remote",
  name: "Peer",
  avatar: "P",
  color: "blue",
  time: "10:00",
  preview: "cached",
  messages: [{ id: 1, remoteId: "old", text: "cached", author: "Peer", time: "10:00", createdAt: 1 }],
  historyExhausted: false,
};
const notify = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.membership.mockResolvedValue({ data: [{ chat_id: "remote" }], error: null });
  mock.page.mockResolvedValue([
    { id: 2, remoteId: "new", author: "Peer", text: "new message", time: "10:01", createdAt: 2 },
  ]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const flush = async () => {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
};
function open() {
  return renderHook(() => {
    const [chats, setChats] = useState([existing]),
      [active, setActiveId] = useState(1);
    return {
      ...useCloudChats({
        accountId: "owner",
        profileReady: true,
        profileName: "Owner",
        notify,
        chats,
        setChats,
        setActiveId,
      }),
      chats,
      active,
    };
  });
}
it("keeps history on a failed load, then retries on reconnect without losing older messages", async () => {
  mock.membership
    .mockResolvedValueOnce({ error: { message: "Failed to fetch" } })
    .mockResolvedValue({ data: [{ chat_id: "remote" }], error: null });
  const hook = open();
  await flush();
  expect(hook.result.current.chatLoadStatus).toBe("error");
  expect(hook.result.current.chats).toEqual([existing]);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await flush();
  expect(hook.result.current.chatLoadStatus).toBe("ready");
  expect(hook.result.current.chats[0].messages.map((message) => message.remoteId)).toEqual(["old", "new"]);
});
it("does not replace an existing chat with empty history when its page fails", async () => {
  mock.page.mockResolvedValue(null);
  const hook = open();
  await flush();
  expect(hook.result.current.chatLoadStatus).toBe("error");
  expect(hook.result.current.chats).toEqual([existing]);
});

it("reloads the chat list on reconnect after an earlier successful load",async()=>{
 const hook=open();await flush();expect(hook.result.current.chatLoadStatus).toBe("ready");
 mock.page.mockResolvedValue([{id:3,remoteId:"third",author:"Peer",text:"after reconnect",time:"10:02",createdAt:3}]);
 await act(async()=>{window.dispatchEvent(new Event("online"))});await flush();
 expect(hook.result.current.chats[0].messages.map(message=>message.remoteId)).toEqual(["old","new","third"]);
});
