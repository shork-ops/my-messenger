/** @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../lib/sendText", () => ({ sendText: send }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
import { useTextOutbox } from "./useTextOutbox";
import type { Chat } from "../types";
const chat: Chat = {
  id: 1,
  remoteId: "chat-1",
  peerId: "peer",
  name: "Peer",
  avatar: "P",
  color: "blue",
  preview: "",
  time: "",
  messages: [],
};
beforeEach(() => {
  window.localStorage.clear();
  send.mockReset();
});
afterEach(cleanup);
function mount(accountId = "account-A") {
  return renderHook(() => {
    const [chats, setChats] = useState([chat]);
    return { ...useTextOutbox({ accountId, profileName: "A", chats, setChats }), chats };
  });
}

it("keeps an unsuccessful message after reload and retries with the same server id", async () => {
  send.mockRejectedValueOnce(new Error("offline"));
  const first = mount();
  await act(async () => {
    first.result.current.queueText(chat, "не потерять");
  });
  await waitFor(() => expect(first.result.current.chats[0].messages[0].delivery).toBe("failed"));
  const uuid = send.mock.calls[0][1].id;
  first.unmount();
  const second = mount();
  await waitFor(() => expect(second.result.current.chats[0].messages[0].text).toBe("не потерять"));
  send.mockResolvedValueOnce({ id: uuid, created_at: "2026-10-31T00:00:00Z" });
  await act(async () => {
    await second.result.current.retryMessage(second.result.current.chats[0].messages[0].id);
  });
  expect(send.mock.calls[1][1].id).toBe(uuid);
  expect(second.result.current.chats[0].messages).toHaveLength(1);
  expect(second.result.current.chats[0].messages[0].delivery).toBe("sent");
});

it("does not restore another account's pending messages", async () => {
  send.mockRejectedValue(new Error("offline"));
  const first = mount();
  await act(async () => {
    first.result.current.queueText(chat, "private A");
  });
  first.unmount();
  const second = mount("account-B");
  expect(second.result.current.chats[0].messages).toEqual([]);
});

it("queues offline and automatically resumes on reconnect with the original UUID", async () => {
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  const hook = mount();
  await act(async () => {
    hook.result.current.queueText(chat, "offline queued");
  });
  expect(send).not.toHaveBeenCalled();
  expect(hook.result.current.chats[0].messages[0].delivery).toBe("queued");
  const storedKey = Object.keys(localStorage).find((key) => key.startsWith("nexus-outbox:account-A:"))!;
  const entry = JSON.parse(localStorage.getItem(storedKey)!);
  send.mockResolvedValue({ id: entry.uuid, created_at: "2026-11-01T10:00:00Z" });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => expect(hook.result.current.chats[0].messages[0].delivery).toBe("sent"));
  expect(send.mock.calls[0][1].id).toBe(entry.uuid);
  expect(localStorage.getItem(storedKey)).toBeNull();
});
it("retains a draft when storage refuses the outgoing message", async () => {
  const notify = vi.fn();
  const hook = renderHook(() => {
    const [chats, setChats] = useState([chat]);
    return { ...useTextOutbox({ accountId: "account-A", profileName: "A", chats, setChats, notify }), chats };
  });
  const failing = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  let accepted;
  await act(async () => {
    accepted = hook.result.current.queueText(chat, "keep draft");
  });
  expect(accepted).toBe(false);
  expect(hook.result.current.chats[0].messages).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalled();
  failing.mockRestore();
});
it("ignores a late acknowledgement after switching away and back to the same account", async () => {
  let finish: (row: unknown) => void = () => {};
  send.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const hook = renderHook(
    ({ owner }) => {
      const [chats, setChats] = useState([chat]);
      return { ...useTextOutbox({ accountId: owner, profileName: "A", chats, setChats }), chats };
    },
    { initialProps: { owner: "account-A" } },
  );
  await act(async () => {
    hook.result.current.queueText(chat, "A secret");
  });
  const firstId = send.mock.calls[0][1].id;
  const originalFinish = finish;
  hook.rerender({ owner: "account-B" });
  hook.rerender({ owner: "account-A" });
  await act(async () => {
    originalFinish({ id: firstId, created_at: "2026-11-01T10:00:00Z" });
  });
  expect(localStorage.getItem(`nexus-outbox:account-A:${firstId}`)).not.toBeNull();
});

it("rejects an old account's enqueue callback after switching accounts", async () => {
  const hook = renderHook(
    ({ owner }) => {
      const [chats, setChats] = useState([chat]);
      return { ...useTextOutbox({ accountId: owner, profileName: "A", chats, setChats }), chats };
    },
    { initialProps: { owner: "account-A" } },
  );
  const stale = hook.result.current.queueText;
  hook.rerender({ owner: "account-B" });
  let accepted;
  await act(async () => {
    accepted = stale(chat, "private A");
  });
  expect(accepted).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect(hook.result.current.chats[0].messages).toEqual([]);
});

it("cancels an unsent message durably before it reaches the network",async()=>{
 Object.defineProperty(navigator,"onLine",{value:false,configurable:true});const hook=mount();
 await act(async()=>{hook.result.current.queueText(chat,"cancel me")});const id=hook.result.current.chats[0].messages[0].id;
 expect(hook.result.current.cancelQueuedMessage(id)).toBe(true);
 Object.defineProperty(navigator,"onLine",{value:true,configurable:true});await act(async()=>{window.dispatchEvent(new Event("online"))});
 expect(send).not.toHaveBeenCalled();expect(Object.keys(localStorage).filter(key=>key.startsWith("nexus-outbox:account-A:"))).toEqual([]);
});
