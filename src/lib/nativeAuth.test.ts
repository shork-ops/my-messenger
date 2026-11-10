import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { url: string }) => void),
  launchUrl: undefined as string | undefined,
  remove: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  exchange: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_name, listener) => { mocks.listener = listener; return { remove: mocks.remove }; }),
    getLaunchUrl: vi.fn(async () => mocks.launchUrl ? { url: mocks.launchUrl } : undefined),
  },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { close: mocks.close } }));
import { listenForNativeAuth } from "./nativeAuth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listener = undefined;
  mocks.launchUrl = undefined;
});

it("exchanges a valid cold-start callback once and ignores unrelated URLs", async () => {
  mocks.launchUrl = "com.nexus.messenger://auth/callback?code=one-time-code";
  const stop = listenForNativeAuth({ auth: { exchangeCodeForSession: mocks.exchange } } as unknown as SupabaseClient, vi.fn());
  await vi.waitFor(() => expect(mocks.exchange).toHaveBeenCalledWith("one-time-code"));
  mocks.listener?.({ url: mocks.launchUrl });
  mocks.listener?.({ url: "com.nexus.messenger://evil/callback?code=other" });
  expect(mocks.exchange).toHaveBeenCalledTimes(1);
  await stop();
  expect(mocks.remove).toHaveBeenCalledOnce();
});

it("reports a failed exchange", async () => {
  mocks.exchange.mockResolvedValueOnce({ error: new Error("expired") });
  const onError = vi.fn();
  const stop = listenForNativeAuth({ auth: { exchangeCodeForSession: mocks.exchange } } as unknown as SupabaseClient, onError);
  await vi.waitFor(() => expect(mocks.listener).toBeDefined());
  mocks.listener?.({ url: "com.nexus.messenger://auth/callback?code=expired" });
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  await stop();
});
