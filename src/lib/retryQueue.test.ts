import { describe, expect, it } from "vitest";
import {
  MAX_PENDING,
  addPending,
  pendingForChat,
  pendingLabel,
  removePending,
  type PendingAttachment,
} from "./retryQueue";

function file(name: string): File {
  return new File(["x"], name, { type: "image/png" });
}

function entry(key: string, chatId: number | null = 1, name = "фото.png"): PendingAttachment {
  return { key, file: file(name), chatId, viewOnce: false, reason: "Не удалось загрузить файл" };
}

describe("a failed upload waiting to be retried", () => {
  it("keeps a failed file so it can be sent again", () => {
    const list = addPending([], entry("a"));
    expect(list).toHaveLength(1);
    expect(list[0].file.name).toBe("фото.png");
  });

  it("does not keep the same file twice", () => {
    const once = addPending([], entry("a"));
    const twice = addPending(once, entry("a"));
    expect(twice).toHaveLength(1);
  });

  it("drops the oldest when the shelf is full, never the newest", () => {
    // A person retrying after an outage cares about the photo they just sent, not the one
    // from ten minutes ago.
    let list: PendingAttachment[] = [];
    for (let index = 0; index < MAX_PENDING + 3; index += 1) {
      list = addPending(list, entry(`k${index}`));
    }
    expect(list).toHaveLength(MAX_PENDING);
    expect(list[list.length - 1].key).toBe(`k${MAX_PENDING + 2}`);
    expect(list.some((item) => item.key === "k0")).toBe(false);
  });

  it("forgets one entry when it is sent or dismissed", () => {
    const list = addPending(addPending([], entry("a")), entry("b"));
    expect(removePending(list, "a").map((item) => item.key)).toEqual(["b"]);
  });

  it("removing something that is not there changes nothing", () => {
    const list = addPending([], entry("a"));
    expect(removePending(list, "нет-такого")).toHaveLength(1);
  });

  it("offers a retry only in the conversation it failed in", () => {
    // Sending a photo into a chat the person was not looking at would be worse than no retry.
    const list = addPending(addPending([], entry("a", 1)), entry("b", 2));
    expect(pendingForChat(list, 1).map((item) => item.key)).toEqual(["a"]);
    expect(pendingForChat(list, 3)).toEqual([]);
  });

  it("offers nothing when no conversation is open", () => {
    expect(pendingForChat(addPending([], entry("a", 1)), null)).toEqual([]);
  });

  it("names the button by the file, and shortens a long name honestly", () => {
    const short = pendingLabel({ ...entry("a"), file: file("кот.png") });
    expect(short).toBe("Повторить «кот.png»");

    const long = pendingLabel({ ...entry("a"), file: file("очень-длинное-имя-файла-из-камеры-2026.png") });
    expect(long.startsWith("Повторить «")).toBe(true);
    expect(long.endsWith("…»")).toBe(true);
    // The whole name must not be silently presented as if it fit.
    expect(long).not.toContain("2026.png");
  });

  it("keeps the view-once intent with the file", () => {
    const list = addPending([], { ...entry("a"), viewOnce: true });
    expect(list[0].viewOnce).toBe(true);
  });
});
