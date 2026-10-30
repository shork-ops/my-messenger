import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app from a sub-path, but a Capacitor WebView loads
  // files from the bundle root, where an absolute /my-messenger/ prefix would
  // 404 every asset. The mobile build therefore uses a relative base.
  base: mode === "mobile" ? "./" : "/my-messenger/",
  // Stamp every build with the commit, so an error report names the exact
  // deploy it came from instead of a generic "production".
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      process.env.GITHUB_SHA?.slice(0, 7) ?? new Date().toISOString().slice(0, 16)
    ),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "inline",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png", "icons/icon-192.png", "manifest.webmanifest"],
      // The web app manifest lives in public/ so GitHub Pages serves it verbatim.
      manifest: false,
      injectManifest: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,woff2,png,ico,webmanifest}"],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    open: false,
  },
  build: {
    rollupOptions: {
      output: {
        // Three groups instead of one monolith: React, the Supabase client and LiveKit
        // change on their own schedule, not ours. Splitting them means a release that
        // touches only app code leaves those chunks untouched and already cached on the
        // user's device, so the download after an update is the app, not the SDKs.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          // Match the package directory, not a substring of the whole path: `includes("react")`
          // also caught lucide-react, which then shipped inside the React chunk.
          const pkg = id.split("node_modules/").pop() ?? "";
          if (pkg.startsWith("livekit-client") || pkg.startsWith("@livekit")) return "livekit";
          if (pkg.startsWith("@supabase")) return "supabase";
          if (pkg.startsWith("react-dom") || pkg.startsWith("react/") || pkg.startsWith("scheduler")) return "react";
          return undefined;
        },
      },
    },
  },
  test: {
    // Logic tests run on Node, where there is no DOM at all; a component test declares
    // its own environment in a docblock comment at the top of the file instead.
    environment: "node",
    // The demo chats exist only in the demo build. Tests that drive the messenger against
    // real conversations need them, and the flag is read at import time, so it is set here
    // rather than in a test file where it would arrive too late.
    env: { VITE_DEMO_MODE: "true", VITE_DEMO_SEED: "true" },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
}));
