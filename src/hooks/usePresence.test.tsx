/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

/** One fake presence channel: records what this account announced and lets a test join it. */
const fake = vi.hoisted(() => {
  const state = { onStatus: null as null | ((status: string) => void), onSync: null as null | (() => void), others: {} as Record<string, unknown> };
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, callback: () => void) => {
      state.onSync = callback;
      return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      state.onStatus = callback;
      return channel;
    }),
    state: "joining",
    track: vi.fn(async () => "ok"),
    untrack: vi.fn(async () => "ok"),
    presenceState: vi.fn(() => state.others),
  };
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
    from: vi.fn(() => ({ update })),
  };
  return { state, channel, client, update };
});
vi.mock("../lib/supabase", () => ({ supabase: fake.client }));

import { usePresence } from "./usePresence";

beforeEach(() => {
  vi.clearAllMocks();
  fake.state.others = {};
  fake.channel.state = "joining";
});
afterEach(() => cleanup());

const join = () =>
  act(() => {
    fake.channel.state = "joined";
    fake.state.onStatus?.("SUBSCRIBED");
  });

describe("usePresence", () => {
  it("announces this account once it has joined, and lists who is online", async () => {
    const { result } = renderHook(() => usePresence({ accountId: "me", announce: true }));
    expect(fake.channel.track).not.toHaveBeenCalled();
    join();
    expect(fake.channel.track).toHaveBeenCalledTimes(1);
    // Only the moment: the name is not needed to tell who is online, so it is not handed out.
    expect(fake.channel.track).toHaveBeenLastCalledWith({ at: expect.any(Number) });
    fake.state.others = { me: [{}], friend: [{}] };
    act(() => fake.state.onSync?.());
    expect(result.current.onlineIds).toEqual(["me", "friend"]);
  });

  it("someone who hid «был(а) в сети» sees others but is never announced", () => {
    const { result } = renderHook(() => usePresence({ accountId: "me", announce: false }));
    join();
    fake.state.others = { friend: [{}] };
    act(() => fake.state.onSync?.());
    expect(result.current.onlineIds).toEqual(["friend"]);
    expect(fake.channel.track).not.toHaveBeenCalled();
    // Joining again after a lost connection does not announce either.
    join();
    expect(fake.channel.track).not.toHaveBeenCalled();
  });

  it("waits for the switch to be known before joining decides", () => {
    const { rerender } = renderHook(({ announce }) => usePresence({ accountId: "me", announce }), { initialProps: { announce: false } });
    rerender({ announce: true });
    expect(fake.channel.track).not.toHaveBeenCalled();
    join();
    expect(fake.channel.track).toHaveBeenCalledTimes(1);
  });

  it("the switch takes effect at once, without leaving the channel", () => {
    const { rerender } = renderHook(({ announce }) => usePresence({ accountId: "me", announce }), { initialProps: { announce: true } });
    join();
    fake.channel.track.mockClear();
    rerender({ announce: false });
    expect(fake.channel.untrack).toHaveBeenCalledTimes(1);
    join();
    expect(fake.channel.track).not.toHaveBeenCalled();
    rerender({ announce: true });
    expect(fake.channel.track).toHaveBeenCalledTimes(1);
    expect(fake.client.channel).toHaveBeenCalledTimes(1);
    expect(fake.client.removeChannel).not.toHaveBeenCalled();
  });

  it("does nothing before there is an account, and leaves the channel on sign-out", () => {
    const { rerender } = renderHook(({ accountId }) => usePresence({ accountId, announce: true }), {
      initialProps: { accountId: null as string | null },
    });
    expect(fake.client.channel).not.toHaveBeenCalled();
    rerender({ accountId: "me" });
    expect(fake.client.channel).toHaveBeenCalledWith("nexus-presence", { config: { presence: { key: "me" } } });
    rerender({ accountId: null });
    expect(fake.client.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("still stamps the time, which the database hands out by the owner's rule", () => {
    renderHook(() => usePresence({ accountId: "me", announce: false }));
    expect(fake.client.from).toHaveBeenCalledWith("profiles");
    expect(fake.update).toHaveBeenCalledWith({ last_seen_at: expect.any(String) });
  });
});
