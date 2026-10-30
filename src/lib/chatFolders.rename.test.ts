import { describe, expect, it } from "vitest";
import { moveFolder, renameFolder, type Folder } from "./chatFolders";

const folder = (overrides: Partial<Folder> = {}): Folder => ({ id: "f1", name: "Работа", chatIds: [], ...overrides });

describe("renameFolder", () => {
  it("changes the name and nothing else", () => {
    const folders = [folder({ id: "f1", name: "Работа", chatIds: ["1"] })];
    const result = renameFolder(folders, "f1", "Учёба");
    expect(result[0].name).toBe("Учёба");
    expect(result[0].chatIds).toEqual(["1"]);
    expect(result[0].id).toBe("f1");
  });

  it("normalises the way a new name is normalised", () => {
    expect(renameFolder([folder()], "f1", "  Моя   папка  ")[0].name).toBe("Моя папка");
  });

  it("refuses a name already used by another folder, whatever its case", () => {
    const folders = [folder({ id: "f1", name: "Работа" }), folder({ id: "f2", name: "Дом" })];
    const result = renameFolder(folders, "f2", "работа");
    expect(result[1].name).toBe("Дом");
  });

  it("allows a folder to be given its own name again", () => {
    const folders = [folder({ id: "f1", name: "Работа" })];
    expect(renameFolder(folders, "f1", "Работа")[0].name).toBe("Работа");
  });

  it("ignores an empty name rather than blanking the folder", () => {
    const folders = [folder({ name: "Работа" })];
    expect(renameFolder(folders, "f1", "   ")[0].name).toBe("Работа");
  });

  it("leaves the list alone when the folder is unknown", () => {
    const folders = [folder({ id: "f1" })];
    expect(renameFolder(folders, "nope", "Имя")).toEqual(folders);
  });

  it("does not mutate the input", () => {
    const folders = [folder({ name: "Работа" })];
    renameFolder(folders, "f1", "Учёба");
    expect(folders[0].name).toBe("Работа");
  });
});

describe("moveFolder", () => {
  const three = () => [
    folder({ id: "a", name: "Первая" }),
    folder({ id: "b", name: "Вторая" }),
    folder({ id: "c", name: "Третья" }),
  ];

  it("moves a folder up", () => {
    expect(moveFolder(three(), "b", "up").map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("moves a folder down", () => {
    expect(moveFolder(three(), "b", "down").map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("does not wrap at the top", () => {
    expect(moveFolder(three(), "a", "up").map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("does not wrap at the bottom", () => {
    expect(moveFolder(three(), "c", "down").map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves the list alone when the folder is unknown", () => {
    expect(moveFolder(three(), "nope", "up").map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const folders = three();
    moveFolder(folders, "a", "down");
    expect(folders.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("handles a single folder", () => {
    const one = [folder({ id: "a" })];
    expect(moveFolder(one, "a", "up")).toEqual(one);
    expect(moveFolder(one, "a", "down")).toEqual(one);
  });
});
