import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import {
  loadAttachmentJobs,
  saveAttachmentJobs,
  deleteAttachmentJob,
  type AttachmentJob,
} from "./attachmentOutbox";
const owner = "queue-owner",
  other = "another-owner";
const job = (key: string, account = owner): AttachmentJob => ({
  key,
  owner: account,
  chatId: 1,
  remoteChatId: "chat",
  queuedAt: Date.now(),
  viewOnce: false,
  files: [
    {
      blob: new Blob(["file contents"], { type: "text/plain" }),
      name: "file.txt",
      type: "text/plain",
      lastModified: 12,
    },
  ],
});
afterEach(async () => {
  for (const account of [owner, other])
    for (const item of await loadAttachmentJobs(account)) await deleteAttachmentJob(account, item.key);
});
it("persists file bytes and metadata across reads and isolates accounts", async () => {
  await saveAttachmentJobs([job("one")]);
  const restored = await loadAttachmentJobs(owner);
  expect(restored).toHaveLength(1);
  expect(await restored[0].files[0].blob.text()).toBe("file contents");
  expect(restored[0].files[0].name).toBe("file.txt");
  expect(await loadAttachmentJobs(other)).toEqual([]);
  await deleteAttachmentJob(other, "one");
  expect(await loadAttachmentJobs(owner)).toHaveLength(1);
});
it("rejects a full selection atomically instead of dropping older pending files", async () => {
  await saveAttachmentJobs([job("old")]);
  await expect(saveAttachmentJobs(Array.from({ length: 20 }, (_, i) => job(`new-${i}`)))).rejects.toThrow(
    "заполнена",
  );
  expect((await loadAttachmentJobs(owner)).map((item) => item.key)).toEqual(["old"]);
});
it("updates a prepared job in place with stable paths", async () => {
  const entry = job("stable");
  await saveAttachmentJobs([entry]);
  entry.prepared = [
    {
      blob: entry.files[0].blob,
      path: "chat/owner/stable-0-file.txt",
      meta: { name: "file.txt", type: "text/plain", size: 13, path: "chat/owner/stable-0-file.txt" },
    },
  ];
  await saveAttachmentJobs([entry]);
  const restored = await loadAttachmentJobs(owner);
  expect(restored).toHaveLength(1);
  expect(restored[0].prepared?.[0].path).toBe(entry.prepared[0].path);
});
