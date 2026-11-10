import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import type { SupabaseClient } from "@supabase/supabase-js";

export const NATIVE_AUTH_CALLBACK = "com.nexus.messenger://auth/callback";

/** Register before reading the launch URL so a warm callback cannot be missed. */
export function listenForNativeAuth(client: SupabaseClient, onError: () => void): () => Promise<void> {
  if (!Capacitor.isNativePlatform()) return async () => {};
  let active = true;
  let lastCode = "";
  const handle = async (value: string) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return;
    }
    if (
      url.protocol !== "com.nexus.messenger:" || url.hostname !== "auth" ||
      url.pathname !== "/callback" || url.port || url.username || url.password ||
      url.searchParams.getAll("code").length > 1
    ) return;
    const code = url.searchParams.get("code");
    if (!code) {
      if (active && url.searchParams.has("error")) onError();
      return;
    }
    if (code === lastCode) return;
    lastCode = code;
    try {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        if (active) onError();
      } else {
        void Browser.close().catch(() => {});
      }
    } catch {
      if (active) onError();
    }
  };
  const listener = App.addListener("appUrlOpen", ({ url }) => { void handle(url); });
  void listener.then(async () => {
    const launch = await App.getLaunchUrl();
    if (active && launch?.url) await handle(launch.url);
  }).catch(() => { if (active) onError(); });
  return async () => {
    active = false;
    await (await listener).remove();
  };
}
