/**
 * A performance stand with a fixed, documented shape.
 *
 * "The app feels fast" is not a measurement, and a measurement taken on a demo of forty
 * messages says nothing about the conversation that actually raises the question. This drives
 * the real application in a real browser over conversations of five thousand and fifty
 * thousand messages and reports what a reader would notice: how long until the history is on
 * screen, how many elements ended up in the page, how long the main thread was blocked.
 *
 * The numbers are printed, not asserted, except for two ceilings that are the whole point of
 * the virtual list. A performance test that fails on a busy build machine teaches people to
 * ignore it; one that never fails teaches nothing.
 *
 * Run with: node scripts/bench-conversations.mjs
 * or:       npm run bench
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const BASE = "/my-messenger/";

/** The sizes that matter: one where a phone starts to struggle, one where it would die. */
const SIZES = [5_000, 50_000];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

if (!existsSync(dist)) {
  console.error("dist/ отсутствует — сначала выполните npm run build:demo");
  process.exit(1);
}

/** A static server for dist/, with the same base path the deployment uses. */
function serve() {
  return new Promise((done) => {
    const server = createServer((request, response) => {
      const url = (request.url ?? "/").split("?")[0];
      const relative = url.startsWith(BASE) ? url.slice(BASE.length) : url.slice(1);
      let file = join(dist, relative || "index.html");
      if (!existsSync(file) || url.endsWith("/")) file = join(dist, "index.html");
      if (!existsSync(file)) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      response.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => done(server));
  });
}

/**
 * Rebuilds the demo with a longer conversation and restores the seed afterwards.
 *
 * The seed lives in the source, so the only honest way to measure fifty thousand messages is
 * to produce them. The file is always put back, even when the build throws.
 */
function buildWith(count) {
  const seed = join(root, "src", "lib", "demoSeed.ts");
  const original = readFileSync(seed, "utf8");
  const replaced = original
    .replace("length: 5000", "length: " + count)
    .replace("Сообщение 5000 из 5000", "Сообщение " + count + " из " + count);
  try {
    if (replaced !== original) writeFileSync(seed, replaced, "utf8");
    execFileSync(process.execPath, [join(root, "scripts", "build-demo.mjs")], {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, VITE_DEMO_MODE: "true", VITE_DEMO_SEED: "true" },
    });
  } finally {
    writeFileSync(seed, original, "utf8");
  }
}

async function measure(browser, port, count) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.__longTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long-task timing is not available everywhere; the other numbers still stand.
    }
  });

  await page.goto("http://127.0.0.1:" + port + BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".chat-row");

  const opened = await page.evaluate(async (expected) => {
    const rows = Array.from(document.querySelectorAll(".chat-row"));
    const target = rows.find((row) => (row.textContent ?? "").includes("Очень длинный"));
    if (!target) return null;
    const started = performance.now();
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // "The history is readable" means the last message number is on the page.
    const deadline = started + 20_000;
    while (performance.now() < deadline) {
      const lines = document.querySelectorAll(".message-line");
      if (lines.length > 0) {
        const last = lines[lines.length - 1].textContent ?? "";
        if (last.includes(String(expected))) break;
      }
      await new Promise((next) => setTimeout(next, 16));
    }
    return {
      openMs: Math.round(performance.now() - started),
      domNodes: document.getElementsByTagName("*").length,
      renderedMessages: document.querySelectorAll("[data-window-item]").length,
      messageLines: document.querySelectorAll(".message-line").length,
    };
  }, count);

  const longTasks = await page.evaluate(() => window.__longTasks ?? []);
  await page.close();

  return {
    count,
    ...(opened ?? { openMs: -1, domNodes: -1, renderedMessages: -1, messageLines: -1 }),
    longestTask: longTasks.length > 0 ? Math.max(...longTasks) : 0,
    totalBlockingMs: longTasks.reduce((sum, value) => sum + Math.max(0, value - 50), 0),
  };
}

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch();
const results = [];

try {
  for (const count of SIZES) {
    console.log("Готовим " + count + " сообщений…");
    buildWith(count);
    const measured = await measure(browser, port, count);
    results.push(measured);
    console.log(
      "  " + count +
        ": открытие " + measured.openMs + " мс, узлов DOM " + measured.domNodes +
        ", сообщений в DOM " + measured.messageLines +
        ", самая длинная задача " + measured.longestTask + " мс"
    );
  }
} finally {
  await browser.close();
  server.close();
}

mkdirSync(join(root, "perf"), { recursive: true });
const report = { measuredAt: new Date().toISOString(), viewport: "1280x900", results };
writeFileSync(join(root, "perf", "conversations.json"), JSON.stringify(report, null, 2) + "\n", "utf8");

console.log("");
console.log("Отчёт: perf/conversations.json");

const failures = [];
for (const row of results) {
  if (row.messageLines > 500) {
    failures.push(row.count + " сообщений: в DOM " + row.messageLines + " строк вместо окна");
  }
  if (row.openMs > 5_000) {
    failures.push(row.count + " сообщений: открытие " + row.openMs + " мс — это уже видимая пауза");
  }
}
if (failures.length > 0) {
  for (const message of failures) console.error("x " + message);
  process.exit(1);
}
console.log("OK: окно держит размер DOM независимо от длины истории");
