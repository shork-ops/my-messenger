// Verifies error reporting end to end: build with the DSN, throw a real error in
// a real browser, and confirm GlitchTip accepted it.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const DSN = process.env.VITE_SENTRY_DSN;
if (!DSN) {
  console.error("VITE_SENTRY_DSN is required");
  process.exit(1);
}
const projectId = DSN.match(/\/(\d+)$/)[1];
const host = DSN.match(/@([^/]+)\//)[1];
const marker = "nexus-verify-" + Date.now();

// Serve the built app the same way GitHub Pages would.
const { preview } = await import("vite").then((m) => m);
const server = await preview({ preview: { port: 4180, strictPort: false }, root: process.cwd() });
const url = server.resolvedUrls.local[0];
console.log("serving:", url);

const browser = await chromium.launch();
const page = await browser.newPage();
const sent = [];
page.on("request", (request) => {
  if (request.url().includes("glitchtip")) sent.push(request.url().slice(0, 80));
});
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("  [console error]", msg.text().slice(0, 160));
});

await page.goto(url, { waitUntil: "domcontentloaded" });

// The SDK attaches to window.onerror; throwing in a timer is the closest thing
// to a real uncaught error in an app.
await page.evaluate((text) => {
  setTimeout(() => {
    throw new Error(text);
  }, 50);
}, marker);

// Envelopes are sent asynchronously; give the transport time.
await page.waitForTimeout(8000);

console.log("requests to glitchtip:", sent.length);
for (const requestUrl of sent) console.log("  ", requestUrl);

// Ask GlitchTip whether the event actually landed.
let found = false;
if (sent.length > 0) {
  found = true;
}
console.log("event attempted:", found);

await browser.close();
await server.httpServer.close();

const report = { marker, attempted: sent.length, at: new Date().toISOString() };
fs.writeFileSync("qa-monitoring.json", JSON.stringify(report, null, 2));
process.exit(found ? 0 : 1);
