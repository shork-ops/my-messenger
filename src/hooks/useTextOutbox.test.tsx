/** @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../lib/sendText", () => ({ sendText: send }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
import { useTextOutbox } from "./useTextOutbox";
import type { Chat } from "../types";
const chat: Chat = { id: 1, remoteId: "chat-1", peerId: "peer", name: "Peer", avatar: "P", color: "blue", preview: "", time: "", messages: [] };
beforeEach(() => { window.localStorage.clear(); send.mockReset(); });
afterEach(cleanup);
function mount(accountId="account-A") {
  return renderHook(() => {
    const [chats, setChats] = useState([chat]);
    return { ...useTextOutbox({ accountId, profileName: "A", chats, setChats }), chats };
  });
}

it("keeps an unsuccessful message after reload and retries with the same server id", async () => {
  send.mockRejectedValueOnce(new Error("offline"));
  const first = mount();
  await act(async () => { first.result.current.queueText(chat,"не потерять"); });
  await waitFor(() => expect(first.result.current.chats[0].messages[0].delivery).toBe("failed"));
  const uuid = send.mock.calls[0][1].id;
  first.unmount();
  const second = mount();
  await waitFor(() => expect(second.result.current.chats[0].messages[0].text).toBe("не потерять"));
  send.mockResolvedValueOnce({ id: uuid, created_at: "2026-10-31T00:00:00Z" });
  await act(async () => { await second.result.current.retryMessage(second.result.current.chats[0].messages[0].id); });
  expect(send.mock.calls[1][1].id).toBe(uuid);
  expect(second.result.current.chats[0].messages).toHaveLength(1);
  expect(second.result.current.chats[0].messages[0].delivery).toBe("sent");
});

it("does not restore another account's pending messages", async () => {
  send.mockRejectedValue(new Error("offline"));
  const first = mount();
  await act(async () => { first.result.current.queueText(chat,"private A"); });
  first.unmount();
  const second = mount("account-B");
  expect(second.result.current.chats[0].messages).toEqual([]);
});
