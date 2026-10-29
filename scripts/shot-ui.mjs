// Captures the UI at desktop, tablet and phone widths so the review can be based
// on what is actually rendered rather than on reading JSX.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SITE = process.env.SITE || "http://127.0.0.1:4191/my-messenger/";
const OUT = "qa-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1180, height: 800 },
  { name: "tablet", width: 834, height: 1000 },
  { name: "phone", width: 390, height: 844 },
];

for (const size of sizes) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    locale: "ru-RU",
  });
  const page = await ctx.newPage();
  await page.goto(SITE + "?shot=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
  // The demo build seeds chats locally, so the list is present without a login.
  await page.waitForSelector(".chat-list, .rail", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + "/" + size.name + "-main.png", fullPage: false });

  // Measure the layout: how much room each region actually gets.
  const metrics = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const overflow = document.documentElement.scrollWidth > window.innerWidth;
    return {
      rail: box(".rail"),
      list: box(".chat-list-panel"),
      conversation: box(".conversation-panel"),
      right: box(".right-panel"),
      composer: box(".composer"),
      header: box(".conversation-header"),
      overflowX: overflow,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
  console.log(size.name, JSON.stringify(metrics));

  await ctx.close();
}

await browser.close();
console.log("screenshots written to " + OUT);
