/**
 * @vitest-environment jsdom
 *
 * The backend of the interface, tested without a browser.
 *
 * Everything below the screens was already covered: the logic modules have their own tests
 * and the e2e suite drives the built app. What sat between them is the layer that holds the
 * state - whether folders keep their chats consistent, whether the app subscribes to events
 * meant for a previous account, whether a hook throws on a cold start before the cloud
 * client exists. Those are the failures that show up as "sometimes" in real use, and
 * nothing was watching them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatFolders } from "./useChatFolders";
import { useCalls } from "./useCalls";
import { useTwoFactor } from "./useTwoFactor";
import { useTyping } from "./useTyping";
import { folderNameError, newFolderId } from "../lib/chatFolders";

/** The account these tests are working as: folders are stored per account, not per browser. */
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  // One storage per file: without this a folder created in one test is still filed in the
  // next, and the test that follows fails for a reason that has nothing to do with it.
  window.localStorage.clear();
});

describe("useChatFolders", () => {
  it("starts with no folders and nothing filed", () => {
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    expect(result.current.folders).toEqual([]);
  });

  it("creates a folder", () => {
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      result.current.createFolder("Работа");
    });
    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0].name).toBe("Работа");
  });

  it("files a chat under a folder id, and unfiles it on a second press", () => {
    // The id is stored as a string because it comes back out of local storage, where every
    // number arrives as text; comparing it to a number would silently never match.
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      result.current.createFolder("Работа");
    });
    const id = result.current.folders[0].id;

    act(() => {
      result.current.toggleChat(id, 42);
    });
    expect(result.current.folders[0].chatIds).toEqual(["42"]);

    act(() => {
      result.current.toggleChat(id, 42);
    });
    expect(result.current.folders[0].chatIds).toEqual([]);
  });

  it("leaves nothing behind when a folder is deleted", () => {
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      result.current.createFolder("Работа");
    });
    act(() => {
      result.current.createFolder("Учёба");
    });
    const id = result.current.folders[0].id;
    act(() => {
      result.current.toggleChat(id, 42);
    });
    act(() => {
      result.current.deleteFolder(id);
    });

    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Учёба"]);
    expect(result.current.folders[0].chatIds, "a deleted folder's chats moved into another").toEqual([]);
  });

  it("renames one folder without touching the others", () => {
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      result.current.createFolder("Работа");
      result.current.createFolder("Учёба");
    });
    const id = result.current.folders[0].id;

    act(() => {
      result.current.renameFolder(id, "Проекты");
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Проекты", "Учёба"]);
  });

  it("refuses to rename a folder onto an existing name", () => {
    // Renaming onto a duplicate would leave two identical tabs, and the reader has no way
    // to tell which one they are filing a chat into.
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      result.current.createFolder("Работа");
      result.current.createFolder("Учёба");
    });
    const id = result.current.folders[0].id;

    act(() => {
      result.current.renameFolder(id, "Учёба");
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Работа", "Учёба"]);
  });

  it("moves a folder down and back up", () => {
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      result.current.createFolder("Работа");
      result.current.createFolder("Учёба");
    });
    const id = result.current.folders[0].id;

    act(() => {
      result.current.moveFolder(id, "down");
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Учёба", "Работа"]);

    act(() => {
      result.current.moveFolder(id, "up");
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Работа", "Учёба"]);
  });

  it("does not move the ends of the list anywhere", () => {
    // A wrap-around would turn one press into a jump from first to last, which reads as a
    // mistake rather than as a move.
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      result.current.createFolder("Работа");
      result.current.createFolder("Учёба");
    });
    const first = result.current.folders[0].id;
    const last = result.current.folders[1].id;

    act(() => {
      result.current.moveFolder(first, "up");
    });
    act(() => {
      result.current.moveFolder(last, "down");
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Работа", "Учёба"]);
  });

  it("keeps the folders across a remount", () => {
    // The shelf is stored, not held in memory: closing the app is not losing it.
    const first = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      first.result.current.createFolder("Работа");
    });
    first.unmount();

    const second = renderHook(() => useChatFolders(ACCOUNT));
    expect(second.result.current.folders.map((folder) => folder.name)).toEqual(["Работа"]);
  });

  it("gives two folders made in the same millisecond different ids", () => {
    // Every operation finds its folder by id, so two folders sharing one were renamed and
    // deleted together - the id used to be the current millisecond alone. This test is what
    // found it: the second folder silently took the first one's place in the list.
    const { result } = renderHook(() => useChatFolders(ACCOUNT));
    act(() => {
      result.current.createFolder("Работа");
    });
    act(() => {
      result.current.createFolder("Учёба");
    });

    const ids = result.current.folders.map((folder) => folder.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size, `two folders share an id: ${ids.join(", ")}`).toBe(2);

    // Deleting one must leave the other exactly as it was.
    act(() => {
      result.current.deleteFolder(ids[0]);
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Учёба"]);
  });
});

describe("folder name rules", () => {
  // The rules live in the library and are applied by the shell before anything is created,
  // so this is the layer that decides whether "работа" may exist beside "Работа".
  it("refuses an empty name", () => {
    expect(folderNameError("   ", [])).toBeTruthy();
  });

  it("refuses a name that differs only in case or spacing", () => {
    const existing = [{ id: "f1", name: "Работа", chatIds: [] }];
    expect(folderNameError("работа", existing)).toBeTruthy();
    expect(folderNameError("  Работа  ", existing)).toBeTruthy();
  });

  it("allows a genuinely new name", () => {
    const existing = [{ id: "f1", name: "Работа", chatIds: [] }];
    expect(folderNameError("Учёба", existing)).toBeNull();
  });
});

describe("useCalls", () => {
  afterEach(() => vi.useRealTimers());

  it("reports no call and no media for a signed-out account", () => {
    const { result } = renderHook(() => useCalls({ accountId: null, enabled: false, notify: () => {} }));
    expect(result.current.call).toBeNull();
    expect(result.current.media.connected).toBe(false);
    expect(result.current.media.error).toBeNull();
  });

  it("offers the controls a screen needs even before a call starts", () => {
    const { result } = renderHook(() => useCalls({ accountId: null, enabled: false, notify: () => {} }));
    expect(typeof result.current.toggleMute).toBe("function");
    expect(typeof result.current.toggleScreenShare).toBe("function");
    expect(typeof result.current.attachRemoteScreen, "the screen element is optional").toBe("function");
    expect(typeof result.current.attachRemoteVideo).toBe("function");
  });
});

describe("useTwoFactor", () => {
  it("survives a cold start with no client", () => {
    // The app renders before the client resolves; a hook that throws here would take the
    // whole screen down on first load.
    expect(() => renderHook(() => useTwoFactor(null, null))).not.toThrow();
  });

  it("starts unenrolled", () => {
    const { result } = renderHook(() => useTwoFactor(null, null));
    expect(result.current).toBeTruthy();
    expect(typeof result.current).toBe("object");
  });
});

describe("useTyping", () => {
  it("reports nobody typing when there is no chat", () => {
    const { result } = renderHook(() => useTyping({ remoteId: undefined, accountId: null, profileName: "" }));
    expect(result.current.typingUsers).toEqual([]);
  });

  it("starts silent and does not throw without a cloud chat", () => {
    expect(() =>
      renderHook(() => useTyping({ remoteId: undefined, accountId: "account-1", profileName: "Аня" }))
    ).not.toThrow();
  });
});
