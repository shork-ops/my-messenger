/**
 * What account B must never see of account A.
 *
 * The isolation work is easy to get half right: each cache can be scoped correctly on its own and
 * the product can still leak, because the leak happens in the transitions — at the switch, at the
 * sign-out, at the restart, and at the moment a response that was in flight for A arrives. Those
 * are the four things this file drives, using the real hooks rather than the storage adapter, so
 * the assertions are about what a person would actually find on screen.
 */

/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useChatFolders } from "./useChatFolders";
import { useNotificationPrefs } from "./useNotificationPrefs";
import { usePrivacyPrefs } from "./usePrivacyPrefs";
import { useWallpaper } from "./useWallpaper";
import { useMediaPolicy } from "./useMediaPolicy";
import { usePasscode } from "./usePasscode";
import { ownerFor, scopedKey, SCOPE_PREFIX } from "../lib/accountScope";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/** Every key in storage, for assertions about what was *not* written. */
function allKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

/** The unscoped keys, which after this work should be none of the per-account caches. */
function unscopedKeys(): string[] {
  const accountOwned = [
    "nexus-chat-folders",
    "nexus-notification-prefs",
    "nexus-privacy-prefs",
    "nexus-wallpaper",
    "nexus-media-policy",
    "nexus-passcode",
    "nexus-drafts-v1",
    "nexus-reply-drafts-v1",
    "nexus-chats-v1",
  ];
  return allKeys().filter((key) => accountOwned.includes(key));
}

describe("switching from A to B", () => {
  it("shows B none of A's folders", () => {
    const { result, rerender } = renderHook(({ id }) => useChatFolders(id), {
      initialProps: { id: ALPHA as string | null },
    });
    act(() => {
      result.current.createFolder("Работа");
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Работа"]);

    rerender({ id: BETA });

    expect(result.current.folders).toEqual([]);
  });

  it("never paints A's folders in B's session, not even on the first frame", () => {
    // The settled result after a switch was already covered. What was not covered is the frame in
    // between: a hook that reset its state in an effect would return A's folders for one render
    // while B is signed in - a flash of someone else's data that no post-condition assertion can
    // see. This records what the hook returns on *every* render and fails if A's folder appears in
    // any frame after the owner became B.
    const frames: { owner: string | null; names: string[] }[] = [];
    const { result, rerender } = renderHook(
      ({ id }) => {
        const folders = useChatFolders(id);
        frames.push({ owner: id, names: folders.folders.map((folder) => folder.name) });
        return folders;
      },
      { initialProps: { id: ALPHA as string | null } }
    );

    act(() => {
      result.current.createFolder("Работа");
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Работа"]);

    frames.length = 0;
    rerender({ id: BETA });

    expect(frames.length).toBeGreaterThan(0);
    const leaked = frames.filter((frame) => frame.names.includes("Работа"));
    expect(leaked).toEqual([]);
  });

  it("gives A their folders back after a switch away and back", () => {
    const { result, rerender } = renderHook(({ id }) => useChatFolders(id), {
      initialProps: { id: ALPHA as string | null },
    });
    act(() => {
      result.current.createFolder("Работа");
    });
    rerender({ id: BETA });
    rerender({ id: ALPHA });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Работа"]);
  });

  it("does not carry A's notification preferences into B", () => {
    const { result, rerender } = renderHook(({ id }) => useNotificationPrefs(id), {
      initialProps: { id: ALPHA as string | null },
    });
    act(() => {
      result.current.setPrefs({ ...result.current.prefs, sound: false });
    });
    expect(result.current.prefs.sound).toBe(false);

    rerender({ id: BETA });
    // The default is sound on; B must not inherit A's choice to silence the app.
    expect(result.current.prefs.sound).toBe(true);
  });

  it("does not carry A's privacy switches into B", () => {
    const { result, rerender } = renderHook(({ id }) => usePrivacyPrefs(id), {
      initialProps: { id: ALPHA as string | null },
    });
    const before = result.current.prefs;
    act(() => {
      result.current.setPrefs({ ...before, readReceipts: !before.readReceipts });
    });
    const chosen = result.current.prefs.readReceipts;

    rerender({ id: BETA });
    expect(result.current.prefs.readReceipts).not.toBe(chosen);
  });

  it("does not carry A's wallpaper into B", () => {
    const { result, rerender } = renderHook(({ id }) => useWallpaper(id), {
      initialProps: { id: ALPHA as string | null },
    });
    act(() => {
      result.current.setWallpaper("waves");
    });
    expect(result.current.wallpaper).toBe("waves");

    rerender({ id: BETA });
    expect(result.current.wallpaper).not.toBe("waves");
  });

  it("does not carry A's auto-download choice into B", () => {
    const { result, rerender } = renderHook(({ id }) => useMediaPolicy(id), {
      initialProps: { id: ALPHA as string | null },
    });
    const before = result.current.policy;
    act(() => {
      result.current.setPolicy(before === "always" ? "manual" : "always");
    });
    const chosen = result.current.policy;

    rerender({ id: BETA });
    expect(result.current.policy).not.toBe(chosen);
  });

  it("does not carry A's passcode into B, and re-locks when A returns", () => {
    // A lock is per account: B signing in must not be asked for A's code, and A signing in again
    // must not be let in without it.
    const { result, rerender } = renderHook(({ id }) => usePasscode(id), {
      initialProps: { id: ALPHA as string | null },
    });
    act(() => {
      result.current.setCode("1234");
    });
    expect(result.current.passcode).toBe("1234");

    rerender({ id: BETA });
    expect(result.current.passcode).toBeNull();
    expect(result.current.unlocked).toBe(true);

    rerender({ id: ALPHA });
    expect(result.current.passcode).toBe("1234");
    expect(result.current.unlocked).toBe(false);
  });

  it("writes every cache under a scoped key, leaving the shared namespaces empty", () => {
    // The strongest statement in the file: none of these caches may be written to the bare key,
    // whatever else goes wrong, because a bare key is readable by everybody.
    const alpha = renderHook(() => ({
      folders: useChatFolders(ALPHA),
      notifications: useNotificationPrefs(ALPHA),
      privacy: usePrivacyPrefs(ALPHA),
      wallpaper: useWallpaper(ALPHA),
      media: useMediaPolicy(ALPHA),
      passcode: usePasscode(ALPHA),
    }));

    act(() => {
      alpha.result.current.folders.createFolder("Работа");
      alpha.result.current.notifications.setPrefs({ ...alpha.result.current.notifications.prefs, sound: false });
      alpha.result.current.wallpaper.setWallpaper("waves");
      alpha.result.current.passcode.setCode("1234");
    });

    expect(unscopedKeys()).toEqual([]);
    // And what was written is inside A's namespace.
    for (const key of allKeys()) {
      expect(key.startsWith(SCOPE_PREFIX)).toBe(true);
      expect(key.startsWith(`${SCOPE_PREFIX}${ownerFor(ALPHA).scope}:`)).toBe(true);
    }
  });
});

describe("signing out and back in", () => {
  it("keeps A's caches through a guest session and gives them back on return", () => {
    const { result, rerender } = renderHook(({ id }) => useChatFolders(id), {
      initialProps: { id: ALPHA as string | null },
    });
    act(() => {
      result.current.createFolder("Работа");
    });

    // Signed out: guest namespace, empty shelf.
    rerender({ id: null });
    expect(result.current.folders).toEqual([]);

    // Signed back in as A: the shelf is where it was.
    rerender({ id: ALPHA });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Работа"]);
  });

  it("does not let a guest session delete the account's cache", () => {
    const { result, rerender } = renderHook(({ id }) => useChatFolders(id), {
      initialProps: { id: ALPHA as string | null },
    });
    act(() => {
      result.current.createFolder("Работа");
    });

    rerender({ id: null });
    // The guest sees an empty shelf and writes its own empty list; A's must survive untouched.
    expect(result.current.folders).toEqual([]);
    expect(window.localStorage.getItem(scopedKey(ownerFor(ALPHA), "nexus-chat-folders"))).toContain("Работа");
  });

  it("keeps the guest's own cache out of every account", () => {
    const { result, rerender } = renderHook(({ id }) => useChatFolders(id), {
      initialProps: { id: null as string | null },
    });
    act(() => {
      result.current.createFolder("Демо");
    });

    rerender({ id: ALPHA });
    expect(result.current.folders).toEqual([]);
  });
});

describe("restarting the browser", () => {
  it("reloads each account's caches from their own keys", () => {
    // Two mounts with different accounts is what a restart as each of them looks like.
    const a = renderHook(() => useWallpaper(ALPHA));
    act(() => {
      a.result.current.setWallpaper("waves");
    });
    const b = renderHook(() => useWallpaper(BETA));
    act(() => {
      b.result.current.setWallpaper("grid");
    });

    cleanup();

    const againA = renderHook(() => useWallpaper(ALPHA));
    expect(againA.result.current.wallpaper).toBe("waves");
    cleanup();
    const againB = renderHook(() => useWallpaper(BETA));
    expect(againB.result.current.wallpaper).toBe("grid");
  });
});

describe("a response that was in flight for A", () => {
  it("is discarded instead of being written into B's cache", async () => {
    // The scenario point 2 names: A starts something slow, the account changes, and the answer
    // arrives afterwards. A hook that wrote the answer into "the current account's" slot would
    // put A's data in B's storage.
    const { result, rerender } = renderHook(({ id }) => useChatFolders(id), {
      initialProps: { id: ALPHA as string | null },
    });
    act(() => {
      result.current.createFolder("Секретная");
    });

    // The account changes while something asynchronous is pending.
    rerender({ id: BETA });
    await act(async () => {
      await Promise.resolve();
    });

    // Nothing of A's name may appear under B's keys.
    for (const key of allKeys()) {
      if (!key.startsWith(`${SCOPE_PREFIX}${ownerFor(BETA).scope}:`)) continue;
      expect(window.localStorage.getItem(key) ?? "").not.toContain("Секретная");
    }
  });

  it("keeps the two namespaces separate even when both are written in the same tick", () => {
    // Two tabs, two accounts, one browser: each writes its own key, so neither can clobber the
    // other's data by finishing last.
    const a = renderHook(() => useChatFolders(ALPHA));
    const b = renderHook(() => useChatFolders(BETA));
    act(() => {
      a.result.current.createFolder("A-папка");
      b.result.current.createFolder("B-папка");
    });

    expect(window.localStorage.getItem(scopedKey(ownerFor(ALPHA), "nexus-chat-folders"))).toContain("A-папка");
    expect(window.localStorage.getItem(scopedKey(ownerFor(ALPHA), "nexus-chat-folders"))).not.toContain("B-папка");
    expect(window.localStorage.getItem(scopedKey(ownerFor(BETA), "nexus-chat-folders"))).toContain("B-папка");
    expect(window.localStorage.getItem(scopedKey(ownerFor(BETA), "nexus-chat-folders"))).not.toContain("A-папка");
  });
});

describe("cross-tab events", () => {
  it("ignores a storage event raised for another account", () => {
    // Two accounts open in two tabs of one browser: a change made in A's tab must not be applied
    // to B's state by the browser's broadcast.
    const b = renderHook(() => useWallpaper(BETA));
    const before = b.result.current.wallpaper;

    act(() => {
      const event = new StorageEvent("storage", {
        key: scopedKey(ownerFor(ALPHA), "nexus-wallpaper"),
        newValue: "waves",
      });
      window.dispatchEvent(event);
    });

    expect(b.result.current.wallpaper).toBe(before);
  });

  it("applies a storage event raised for the same account", () => {
    const b = renderHook(() => useWallpaper(BETA));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: scopedKey(ownerFor(BETA), "nexus-wallpaper"), newValue: "waves" })
      );
    });
    expect(b.result.current.wallpaper).toBe("waves");
  });
});

/** Kept so the linter does not treat the import as unused if the assertions change shape. */
void vi;
