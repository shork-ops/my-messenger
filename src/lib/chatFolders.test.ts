import { describe, expect, it } from "vitest";
import {
  MAX_FOLDERS,
  chatsInFolder,
  folderIdsForChat,
  folderLabel,
  folderNameError,
  normalizeFolderName,
  parseFolders,
  serializeFolders,
  toggleChatInFolder,
  type Folder,
} from "./chatFolders";

const folder = (overrides: Partial<Folder> = {}): Folder => ({ id: "f1", name: "Работа", chatIds: [], ...overrides });

describe("parseFolders", () => {
  it("reads what it wrote", () => {
    const folders = [folder({ chatIds: ["1", "2"] })];
    expect(parseFolders(serializeFolders(folders))).toEqual(folders);
  });

  it("returns an empty list for nothing", () => {
    expect(parseFolders(null)).toEqual([]);
    expect(parseFolders("")).toEqual([]);
  });

  it("survives broken JSON", () => {
    expect(parseFolders("{not json")).toEqual([]);
  });

  it("drops entries that are not folders rather than guessing", () => {
    const raw = JSON.stringify([folder(), { id: "x" }, null, 42, { id: "y", name: "a", chatIds: [1] }]);
    expect(parseFolders(raw)).toHaveLength(1);
  });

  it("drops a list that is not an array", () => {
    expect(parseFolders(JSON.stringify({ folders: [] }))).toEqual([]);
  });

  it("refuses more than the limit", () => {
    const many = Array.from({ length: MAX_FOLDERS + 3 }, (_, index) => folder({ id: `f${index}` }));
    expect(parseFolders(JSON.stringify(many))).toHaveLength(MAX_FOLDERS);
  });
});

describe("normalizeFolderName", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeFolderName("  Работа   и дом  ")).toBe("Работа и дом");
  });

  it("caps a very long name", () => {
    expect(normalizeFolderName("я".repeat(100)).length).toBe(40);
  });
});

describe("folderNameError", () => {
  it("accepts a fresh name", () => {
    expect(folderNameError("Работа", [])).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(folderNameError("   ", [])).toBe("Введите название папки");
  });

  it("rejects a name already taken, whatever the case", () => {
    expect(folderNameError("работа", [folder({ name: "Работа" })])).toBe("Папка с таким названием уже есть");
  });

  it("rejects a new folder when the limit is reached", () => {
    const full = Array.from({ length: MAX_FOLDERS }, (_, index) => folder({ id: `f${index}`, name: `F${index}` }));
    expect(folderNameError("Новая", full)).toContain(String(MAX_FOLDERS));
  });
});

describe("toggleChatInFolder", () => {
  it("adds a chat", () => {
    expect(toggleChatInFolder(folder(), 7).chatIds).toEqual(["7"]);
  });

  it("removes a chat that is already there", () => {
    expect(toggleChatInFolder(folder({ chatIds: ["7", "8"] }), 7).chatIds).toEqual(["8"]);
  });

  it("treats a number and its text the same", () => {
    expect(toggleChatInFolder(folder({ chatIds: ["7"] }), "7").chatIds).toEqual([]);
  });

  it("leaves the original alone", () => {
    const original = folder();
    toggleChatInFolder(original, 1);
    expect(original.chatIds).toEqual([]);
  });
});

describe("chatsInFolder", () => {
  const chats = [
    { id: 1, name: "Аня" },
    { id: 2, name: "Игорь" },
    { id: 3, name: "Максим" },
  ];

  it("keeps the order the chat list already has", () => {
    expect(chatsInFolder(folder({ chatIds: ["3", "1"] }), chats).map((chat) => chat.name)).toEqual(["Аня", "Максим"]);
  });

  it("ignores ids that no longer exist", () => {
    expect(chatsInFolder(folder({ chatIds: ["1", "99"] }), chats)).toHaveLength(1);
  });

  it("returns nothing for an empty folder", () => {
    expect(chatsInFolder(folder(), chats)).toEqual([]);
  });
});

describe("folderLabel", () => {
  it("shows the count", () => {
    expect(folderLabel(folder({ chatIds: ["1", "2"] }))).toBe("Работа · 2");
  });
});

describe("folderIdsForChat", () => {
  it("returns every folder a chat is in", () => {
    const folders = [folder({ id: "a", chatIds: ["1"] }), folder({ id: "b", chatIds: ["1", "2"] }), folder({ id: "c" })];
    expect(folderIdsForChat(folders, 1)).toEqual(["a", "b"]);
  });

  it("returns nothing for a chat in no folder", () => {
    expect(folderIdsForChat([folder()], 5)).toEqual([]);
  });
});
