import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app from a sub-path, but a Capacitor WebView loads
  // files from the bundle root, where an absolute /my-messenger/ prefix would
  // 404 every asset. The mobile build therefore uses a relative base.
  base: mode === "mobile" ? "./" : "/my-messenger/",
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
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
