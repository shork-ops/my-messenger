import { describe, expect, it } from "vitest";
import {
  exportAsJson,
  exportAsText,
  exportFileName,
  formatExportStamp,
  messageLine,
  pluralMessages,
  type ExportableMessage,
} from "./exportChat";

const AT = Date.parse("2026-10-29T14:05:00+07:00");
const messages: ExportableMessage[] = [
  { author: "Аня", text: "Привет!", createdAt: "2026-10-27T10:00:00+07:00" },
  { author: "Я", text: "Привет", createdAt: "2026-10-27T10:01:00+07:00" },
  { author: "Аня", text: "фото.png", createdAt: "2026-10-28T09:00:00+07:00", attachment: { name: "фото.png", type: "image/png", size: 2048 } },
];

describe("exportFileName", () => {
  it("includes the chat and the day", () => {
    expect(exportFileName("Команда", AT, "txt")).toBe("Команда 2026-10-29.txt");
  });

  it("replaces characters a file system rejects", () => {
    expect(exportFileName("a/b:c*d", AT, "json")).toBe("a-b-c-d 2026-10-29.json");
  });

  it("falls back when the chat has no usable name", () => {
    expect(exportFileName("   ", AT, "txt")).toBe("chat 2026-10-29.txt");
  });

  it("truncates a very long name", () => {
    expect(exportFileName("я".repeat(100), AT, "txt").length).toBeLessThan(60);
  });
});

describe("formatExportStamp", () => {
  it("reads as a date", () => {
    expect(formatExportStamp("2026-10-27T10:00:00+07:00")).toContain("2026");
  });

  it("returns nothing for a missing or broken timestamp", () => {
    expect(formatExportStamp(undefined)).toBe("");
    expect(formatExportStamp("")).toBe("");
    expect(formatExportStamp("not a date")).toBe("");
  });
});

describe("messageLine", () => {
  it("puts the author first", () => {
    expect(messageLine(messages[0])).toContain("Аня: Привет!");
  });

  it("includes a readable timestamp", () => {
    expect(messageLine(messages[0])).toMatch(/^\[.*2026.*\] Аня: Привет!$/);
  });

  it("notes an attachment instead of dropping it", () => {
    const line = messageLine(messages[2]);
    expect(line).toContain("вложение: фото.png");
    expect(line).toContain("image/png");
  });

  it("copes with a message that has no timestamp", () => {
    const line = messageLine({ author: "Аня", text: "старое" });
    expect(line).toBe("Аня: старое");
  });
});

describe("exportAsText", () => {
  it("explains itself, so a file found later makes sense", () => {
    const text = exportAsText("Команда", messages, AT);
    expect(text).toContain("Переписка: Команда");
    expect(text).toContain("Выгружено:");
    expect(text).toContain("Сообщений: 3");
  });

  it("keeps the order the messages were in", () => {
    const text = exportAsText("Команда", messages, AT);
    expect(text.indexOf("Привет!")).toBeLessThan(text.indexOf("Привет\n") === -1 ? Infinity : text.indexOf("Я: Привет"));
  });

  it("includes every message", () => {
    const text = exportAsText("Команда", messages, AT);
    for (const message of messages) expect(text).toContain(message.text);
  });

  it("handles an empty conversation without breaking", () => {
    const text = exportAsText("Пустой", [], AT);
    expect(text).toContain("Сообщений: 0");
  });
});

describe("exportAsJson", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(exportAsJson("Команда", messages, AT))).not.toThrow();
  });

  it("keeps the fields rather than a rendering of them", () => {
    const data = JSON.parse(exportAsJson("Команда", messages, AT));
    expect(data.chat).toBe("Команда");
    expect(data.count).toBe(3);
    expect(data.messages[0].author).toBe("Аня");
    expect(data.messages[0].createdAt).toBe("2026-10-27T10:00:00+07:00");
  });

  it("records a null for what is missing rather than omitting the key", () => {
    const data = JSON.parse(exportAsJson("Команда", [{ author: "Аня", text: "привет" }], AT));
    expect(data.messages[0].createdAt).toBeNull();
    expect(data.messages[0].attachment).toBeNull();
  });

  it("keeps the attachment details", () => {
    const data = JSON.parse(exportAsJson("Команда", messages, AT));
    expect(data.messages[2].attachment).toEqual({ name: "фото.png", type: "image/png", size: 2048 });
  });

  it("round-trips Cyrillic", () => {
    const data = JSON.parse(exportAsJson("Команда", [{ author: "Аня", text: "Привет, мир" }], AT));
    expect(data.messages[0].text).toBe("Привет, мир");
  });
});

describe("pluralMessages", () => {
  it("inflects Russian correctly", () => {
    expect(pluralMessages(1)).toBe("1 сообщение");
    expect(pluralMessages(2)).toBe("2 сообщения");
    expect(pluralMessages(4)).toBe("4 сообщения");
    expect(pluralMessages(5)).toBe("5 сообщений");
    expect(pluralMessages(11)).toBe("11 сообщений");
    expect(pluralMessages(12)).toBe("12 сообщений");
    expect(pluralMessages(21)).toBe("21 сообщение");
    expect(pluralMessages(22)).toBe("22 сообщения");
    expect(pluralMessages(0)).toBe("0 сообщений");
  });
});
