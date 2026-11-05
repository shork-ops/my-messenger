import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverAttachment } from "./attachmentDelivery";
import {
  saveAttachmentJobs,
  loadAttachmentJobs,
  deleteAttachmentJob,
  type AttachmentJob,
} from "./attachmentOutbox";
const owner = "delivery-test";
const job = (): AttachmentJob => ({
  key: crypto.randomUUID(),
  owner,
  chatId: 1,
  remoteChatId: "chat",
  queuedAt: 1,
  viewOnce: false,
  files: [
    {
      blob: new Blob(["test file"], { type: "application/pdf" }),
      name: "test.pdf",
      type: "application/pdf",
      lastModified: 1,
    },
  ],
});
afterEach(async () => {
  for (const entry of await loadAttachmentJobs(owner)) await deleteAttachmentJob(owner, entry.key);
});
function server() {
  const state = {
    row: null as Record<string, unknown> | null,
    objects: new Set<string>(),
    lostUpload: false,
    lostInsert: false,
    failLookup: false,
    insertCount: 0,
  };
  const upload = vi.fn(async (path: string) => {
    const exists = state.objects.has(path);
    state.objects.add(path);
    if (state.lostUpload) {
      state.lostUpload = false;
      return { error: { message: "Failed to fetch" } };
    }
    return { error: exists ? { statusCode: "409", message: "The resource already exists" } : null };
  });
  const remove = vi.fn();
  const client = {
    storage: { from: () => ({ upload, remove }) },
    from: () => {
      let payload: Record<string, unknown> | undefined;
      const query = {
        select: () => query,
        eq: () => query,
        insert: (value: Record<string, unknown>) => {
          payload = value;
          return query;
        },
        maybeSingle: async () => {
          if (state.failLookup) {
            state.failLookup = false;
            return { error: { message: "Failed to fetch" } };
          }
          return { data: state.row, error: null };
        },
        single: async () => {
          state.insertCount++;
          state.row = { ...payload, created_at: "2026-11-01T10:00:00Z" };
          if (state.lostInsert) {
            state.lostInsert = false;
            state.failLookup = true;
            return { error: { message: "Failed to fetch" } };
          }
          return { data: state.row, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, state, upload, remove };
}
it("retains a file after a committed insert loses its response and acknowledges it after restart", async () => {
  const entry = job(),
    api = server();
  await saveAttachmentJobs([entry]);
  api.state.lostInsert = true;
  await expect(
    deliverAttachment(
      api.client,
      entry,
      () => true,
      () => {},
    ),
  ).rejects.toMatchObject({ message: "Failed to fetch" });
  expect(api.state.row).not.toBeNull();
  expect(api.state.objects.size).toBe(1);
  expect(api.remove).not.toHaveBeenCalled();
  const restored = (await loadAttachmentJobs(owner))[0];
  const row = await deliverAttachment(
    api.client,
    restored,
    () => true,
    () => {},
  );
  expect(row.id).toBe(entry.key);
  expect(api.state.insertCount).toBe(1);
  expect(api.upload).toHaveBeenCalledTimes(1);
});
it("reuses a storage path after an upload succeeds but its acknowledgement is lost", async () => {
  const entry = job(),
    api = server();
  await saveAttachmentJobs([entry]);
  api.state.lostUpload = true;
  await expect(
    deliverAttachment(
      api.client,
      entry,
      () => true,
      () => {},
    ),
  ).rejects.toMatchObject({ message: "Failed to fetch" });
  const restored = (await loadAttachmentJobs(owner))[0];
  await deliverAttachment(
    api.client,
    restored,
    () => true,
    () => {},
  );
  expect(api.upload.mock.calls.map((call) => call[0])).toEqual([
    restored.prepared![0].path,
    restored.prepared![0].path,
  ]);
  expect(api.state.objects.size).toBe(1);
  expect(api.state.insertCount).toBe(1);
});
it("does not publish when the account becomes inactive during an upload", async () => {
  const entry = job(),
    api = server();
  await saveAttachmentJobs([entry]);
  let active = true;
  api.upload.mockImplementationOnce(async () => {
    active = false;
    return { error: null };
  });
  await expect(
    deliverAttachment(
      api.client,
      entry,
      () => active,
      () => {},
    ),
  ).rejects.toThrow("остановлена");
  expect(api.state.insertCount).toBe(0);
  expect(await loadAttachmentJobs(owner)).toHaveLength(1);
});
