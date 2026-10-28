import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/my-messenger/",
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
});
