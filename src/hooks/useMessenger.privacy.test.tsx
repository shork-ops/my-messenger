/**
 * @vitest-environment jsdom
 *
 * The account's own privacy, as the app reads it on start.
 *
 * Moving code between hooks once dropped the reading of the two privacy switches and of the block
 * list, and nothing noticed: after every reload the window showed both switches off, turning one
 * on saved the other as off, and nobody could be unblocked. These tests mount the hook against a
 * stand-in server that holds both switches on and one blocked person.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const server = vi.hoisted(() => {
  const seen: string[] = [];
  // What the stand-in answers, by the call that asked. Anything else gets nothing, as an empty
  // project would answer.
  const route = (path: string) => {
    seen.push(path);
    if (path.startsWith("auth.getUser(")) return { data: { user: { id: "me", email: "me@example.invalid" } }, error: null };
    if (path.includes("from(profiles).select(profile_visibility, message_policy, hide_last_seen, disable_read_receipts, details_visibility)"))
      return {
        data: { profile_visibility: "everyone", message_policy: "everyone", details_visibility: "everyone", hide_last_seen: true, disable_read_receipts: true },
        error: null,
      };
    if (path.includes("from(user_blocks).select(blocked_id)")) return { data: [{ blocked_id: "b1" }], error: null };
    if (path.includes("from(profiles).select(id, display_name).in(id)")) return { data: [{ id: "b1", display_name: "Вася" }], error: null };
    return { data: null, error: null };
  };
  // Every chain of calls on the client is answered, however long: the hook touches many tables.
  const node = (path: string): unknown =>
    new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === "then") {
          const answer = route(path);
          return (resolve: (value: unknown) => void) => resolve(answer);
        }
        if (typeof prop === "symbol") return undefined;
        // Every channel joins at once.
        if (prop === "state") return "joined";
        return node(path ? `${path}.${prop}` : prop);
      },
      apply(_target, _self, args: unknown[]) {
        const called = `${path}(${args.filter((arg) => typeof arg === "string").join(", ")})`;
        seen.push(called);
        if (path.endsWith(".subscribe") && typeof args[0] === "function") {
          const joined = args[0] as (status: string) => void;
          setTimeout(() => joined("SUBSCRIBED"), 0);
        }
        return node(called);
      },
    });
  return { client: node(""), seen };
});
vi.mock("../lib/supabase", () => ({ supabase: server.client }));

import { useMessenger } from "./useMessenger";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

describe("useMessenger: the account's privacy on start", () => {
  it("reads both switches and the block list, with names", async () => {
    const { result } = renderHook(() => useMessenger());
    await waitFor(() => expect(result.current.privacy).toEqual({ hideLastSeen: true, disableReadReceipts: true }));
    await waitFor(() => expect(result.current.blockedEntries).toEqual(["b1:Вася"]));
  });

  it("someone who hid «был(а) в сети» is never announced as online, not even before the switch is read", async () => {
    server.seen.length = 0;
    const { result } = renderHook(() => useMessenger());
    await waitFor(() => expect(result.current.privacy.hideLastSeen).toBe(true));
    // The presence channel has joined by now; the stand-in answers every join at once.
    expect(server.seen.some((path) => path.includes("channel(nexus-presence)") && path.includes(".subscribe"))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.seen.filter((path) => path.includes(".track"))).toEqual([]);
  });
});
