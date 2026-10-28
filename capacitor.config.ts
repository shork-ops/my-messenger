import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wrapper around the PWA.
 *
 * `webDir` points at the regular Vite output: `npm run cap:sync` builds with
 * `--mode mobile` first, which is what makes asset URLs relative instead of the
 * GitHub Pages sub-path.
 *
 * The server block is deliberately absent: switching to a remote `server.url`
 * would turn the app into a thin browser shell and break offline behaviour, so
 * the bundled copy stays the source of truth and talks to Supabase directly.
 */
const config: CapacitorConfig = {
  appId: "com.nexus.messenger",
  appName: "Nexus",
  webDir: "dist",
  android: {
    // Mixed content must stay off: the app talks to Supabase over https only.
    allowMixedContent: false,
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
