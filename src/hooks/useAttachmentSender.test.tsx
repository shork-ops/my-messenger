/** @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangeEvent } from "react";
import type { Chat } from "../types";
const mock = vi.hoisted(() => ({ jobs: new Map<string, any>(), save: vi.fn(), deliver: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../lib/attachmentOutbox", () => ({
  AttachmentQueueFullError: class extends Error {},
  loadAttachmentJobs: async (owner: string) => [...mock.jobs.values()].filter((job) => job.owner === owner),
  saveAttachmentJobs: (jobs: any[]) => mock.save(jobs),
  deleteAttachmentJob: async (owner: string, key: string) => {
    if (mock.jobs.get(key)?.owner === owner) mock.jobs.delete(key);
  },
}));
vi.mock("../lib/attachmentDelivery", () => ({ deliverAttachment: mock.deliver }));
vi.mock("../lib/messageSync", () => ({
  mapMessageRow: async (row: any) => ({
    id: 99,
    remoteId: row.id,
    author: "Me",
    text: row.body,
    time: "10:00",
    createdAt: 1,
  }),
}));
import { useAttachmentSender } from "./useAttachmentSender";
const chat = (id: number): Chat => ({
  id,
  remoteId: `chat-${id}`,
  name: `Chat ${id}`,
  avatar: "C",
  color: "blue",
  preview: "",
  time: "",
  messages: [],
});
const notify = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mock.jobs.clear();
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  mock.save.mockImplementation(async (jobs) => {
    for (const job of jobs) mock.jobs.set(job.key, job);
  });
  mock.deliver.mockImplementation(async (_client, job) => ({ id: job.key, body: "attachment" }));
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
function open() {
  return renderHook(
    ({ owner, active }) => {
      const [chats, setChats] = useState([chat(1), chat(2)]);
      return {
        ...useAttachmentSender({
          accountId: owner,
          activeChatId: active,
          profileName: "Me",
          chats,
          setChats,
          notify,
          recordingStartedRef: { current: null },
          setRecordingSeconds: () => {},
        }),
        chats,
      };
    },
    { initialProps: { owner: "A", active: 1 } },
  );
}
const input = () =>
  ({
    target: {
      files: [new File(["%PDF-1.4"], "file.pdf", { type: "application/pdf" })],
      dataset: {},
      value: "file.pdf",
    },
  }) as unknown as ChangeEvent<HTMLInputElement>;
it("retains the original chat when retrying an attachment after switching conversations", async () => {
  const hook = open();
  await act(async () => {
    await hook.result.current.handleAttachment(input());
  });
  await waitFor(() => expect(hook.result.current.failedUploads).toHaveLength(1));
  const entry = hook.result.current.failedUploads[0];
  hook.rerender({ owner: "A", active: 2 });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  await act(async () => {
    await hook.result.current.retryFailedUpload(entry);
  });
  expect(mock.deliver.mock.calls[0][1].remoteChatId).toBe("chat-1");
  expect(hook.result.current.chats[0].messages).toHaveLength(1);
  expect(hook.result.current.chats[1].messages).toEqual([]);
  expect(mock.jobs.size).toBe(0);
});
it("retains an old account's file when its acknowledgement arrives after switching accounts", async () => {
  const hook = open();
  await act(async () => {
    await hook.result.current.handleAttachment(input());
  });
  const entry = hook.result.current.failedUploads[0];
  let finish: (row: unknown) => void = () => {};
  mock.deliver.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  let sending: Promise<void>;
  await act(async () => {
    sending = hook.result.current.retryFailedUpload(entry);
    await Promise.resolve();
    await Promise.resolve();
  });
  hook.rerender({ owner: "B", active: 2 });
  await act(async () => {
    finish({ id: entry.key, body: "A private file" });
    await sending!;
  });
  expect(hook.result.current.failedUploads).toEqual([]);
  expect(hook.result.current.chats.every((chat) => !chat.messages.length)).toBe(true);
  expect(mock.jobs.has(entry.key)).toBe(true);
});
it("keeps a file in memory and explains that it is not durable when IndexedDB refuses the write", async () => {
  mock.save.mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
  const hook = open();
  await act(async () => {
    await hook.result.current.handleAttachment(input());
  });
  expect(hook.result.current.failedUploads[0].file.name).toBe("file.pdf");
  expect(hook.result.current.failedUploads[0].reason).toContain("Не закрывай вкладку");
  expect(mock.deliver).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalled();
});
