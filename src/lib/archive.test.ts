import { describe, expect, it } from "vitest";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  archiveFileName,
  archiveMessageCount,
  archiveSummary,
  buildArchive,
  parseArchive,
  pluralChats,
  type ArchiveParts,
} from "./archive";

const AT = Date.parse("2026-10-29T10:00:00Z");

function parts(overrides: Partial<ArchiveParts> = {}): ArchiveParts {
  return {
    profile: { name: "Алексей", username: "alex" },
    settings: { theme: "dark", language: "ru" },
    folders: [{ id: "f1", name: "Семья", chatIds: ["1"] }],
    chats: [
      {
        name: "Аня",
        kind: "chat",
        messages: [
          { author: "Аня", text: "привет", createdAt: "2026-10-29T09:00:00Z" },
          { author: "Алексей", text: "привет", createdAt: "2026-10-29T09:01:00Z" },
        ],
      },
      {
        name: "Команда",
        kind: "group",
        pinned: true,
        unread: 3,
        messages: [
          { author: "Игорь", text: "совещание в три", createdAt: "2026-10-29T09:30:00Z" },
          {
            author: "Аня",
            text: "фото",
            createdAt: "2026-10-29T09:31:00Z",
            attachment: { name: "кот.jpg", type: "image/jpeg", size: 2048 },
            viewOnce: true,
          },
        ],
      },
      { name: "Новости", kind: "channel", messages: [] },
    ],
    ...overrides,
  };
}

describe("the name of the archive file", () => {
  it("carries the date so two archives can be told apart", () => {
    expect(archiveFileName(AT)).toBe("Nexus 2026-10-29.json");
  });
});

describe("counting what is in the archive", () => {
  it("counts messages across every conversation", () => {
    expect(archiveMessageCount(parts())).toBe(4);
  });

  it("counts nothing for an empty account", () => {
    expect(archiveMessageCount(parts({ chats: [] }))).toBe(0);
  });

  it("declines the word 'chat' correctly", () => {
    expect(pluralChats(1)).toBe("1 чат");
    expect(pluralChats(2)).toBe("2 чата");
    expect(pluralChats(5)).toBe("5 чатов");
    expect(pluralChats(11)).toBe("11 чатов");
    expect(pluralChats(21)).toBe("21 чат");
  });

  it("summarises both numbers in one line", () => {
    expect(archiveSummary(parts())).toBe("3 чата, 4 сообщения");
  });
});

describe("the archive itself", () => {
  it("is a readable JSON file, not a minified blob", () => {
    const text = buildArchive(parts(), AT);
    expect(text).toContain("\n");
    expect(text.split("\n").length).toBeGreaterThan(10);
  });

  it("declares its format and version, so a reader knows what it has", () => {
    const data = JSON.parse(buildArchive(parts(), AT));
    expect(data.format).toBe(ARCHIVE_FORMAT);
    expect(data.version).toBe(ARCHIVE_VERSION);
    expect(data.exportedAt).toBe("2026-10-29T10:00:00.000Z");
  });

  it("holds every conversation with its messages", () => {
    const data = JSON.parse(buildArchive(parts(), AT));
    expect(data.chats).toHaveLength(3);
    expect(data.chats[0].messages).toHaveLength(2);
    expect(data.total).toEqual({ chats: 3, messages: 4 });
  });

  it("keeps the profile, the settings and the folders", () => {
    const data = JSON.parse(buildArchive(parts(), AT));
    expect(data.profile.name).toBe("Алексей");
    expect(data.settings.theme).toBe("dark");
    expect(data.folders).toHaveLength(1);
  });

  it("says in the file that attachments are not included", () => {
    // A person opening the archive in a year must not conclude the empty pictures are a bug.
    const data = JSON.parse(buildArchive(parts(), AT));
    expect(String(data.note)).toContain("не входят");
  });

  it("keeps the single-view marker, which is part of the message", () => {
    const data = JSON.parse(buildArchive(parts(), AT));
    expect(data.chats[1].messages[1].viewOnce).toBe(true);
  });

  it("keeps a message written over several lines as several lines", () => {
    const multi = parts({
      chats: [{ name: "Аня", kind: "chat", messages: [{ author: "Аня", text: "первая\nвторая" }] }],
    });
    expect(JSON.parse(buildArchive(multi, AT)).chats[0].messages[0].text).toBe("первая\nвторая");
  });
});

describe("reading an archive back", () => {
  it("returns what was written", () => {
    const source = parts();
    const read = parseArchive(buildArchive(source, AT));
    expect(read).not.toBeNull();
    expect(read?.profile.name).toBe(source.profile.name);
    expect(read?.chats).toHaveLength(source.chats.length);
    expect(read?.settings.theme).toBe("dark");
  });

  it("refuses a file that is not an archive", () => {
    // Half-parsing a wrong file is worse than saying it is the wrong file.
    expect(parseArchive("{ not json")).toBeNull();
    expect(parseArchive(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseArchive(JSON.stringify({ format: "something-else" }))).toBeNull();
    expect(parseArchive("null")).toBeNull();
  });

  it("fills in missing optional parts rather than failing", () => {
    const minimal = JSON.stringify({ format: ARCHIVE_FORMAT, profile: { name: "Аня" }, chats: [] });
    const read = parseArchive(minimal);
    expect(read?.settings).toEqual({});
    expect(read?.folders).toEqual([]);
  });
});
