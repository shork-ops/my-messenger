// Measures every interactive control: size, position, spacing. Visual review by
// hand is not available, so the numbers have to carry the report.
import { chromium } from "@playwright/test";

const SITE = process.env.SITE || "http://127.0.0.1:4192/my-messenger/";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const page = await ctx.newPage();
await page.goto(SITE + "?m=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector(".chat-list", { timeout: 30000 });
await page.waitForTimeout(1200);

const data = await page.evaluate(() => {
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 40),
      label: el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent || "").trim().slice(0, 24),
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
      font: style.fontSize,
      radius: style.borderRadius,
      fg: style.color,
      bg: style.backgroundColor,
    };
  };

  const controls = [...document.querySelectorAll("button, a, input")].map(describe);

  // Touch target audit: 44px is the Apple guideline, 48px the Material one.
  const small = controls.filter((c) => c.tag === "button" && (c.w < 44 || c.h < 44));

  // Vertical rhythm inside the composer.
  const composerKids = [...document.querySelectorAll(".composer > *")].map(describe);

  // Palette actually used, most common first.
  const colors = {};
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    for (const key of ["color", "backgroundColor"]) {
      const v = s[key];
      if (!v || v === "rgba(0, 0, 0, 0)" || v === "transparent") continue;
      colors[v] = (colors[v] || 0) + 1;
    }
  }
  const palette = Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 14);

  const fonts = {};
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    const key = s.fontFamily.split(",")[0].replace(/["']/g, "");
    fonts[key] = (fonts[key] || 0) + 1;
  }

  const sizes = {};
  for (const el of document.querySelectorAll("*")) {
    if (!(el.textContent || "").trim()) continue;
    const fs = getComputedStyle(el).fontSize;
    sizes[fs] = (sizes[fs] || 0) + 1;
  }

  return {
    totalControls: controls.length,
    smallTargets: small.map((c) => c.cls + " (" + c.label + ") " + c.w + "x" + c.h),
    composerKids,
    palette,
    fonts,
    sizes: Object.entries(sizes).sort((a, b) => b[1] - a[1]),
    headerButtons: [...document.querySelectorAll(".conversation-tools button")].map(describe),
  };
});

console.log(JSON.stringify(data, null, 1));
await browser.close();
