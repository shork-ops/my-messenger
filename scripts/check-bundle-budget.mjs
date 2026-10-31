/**
 * Keeps the first screen from quietly growing.
 *
 * The bundle has already been split once, because five thousand messages used to arrive with
 * the whole application and opening a chat took two and a half seconds. That work is easy to
 * undo by accident: one import at the top of a component pulls a chunk back into the first
 * paint, and nothing notices - the build still succeeds, the tests still pass, and the only
 * visible effect is that the app feels slower on a phone over a weak connection.
 *
 * What counts as the first screen is deliberately not guessed from the source. `index.html`
 * is the browser's own list: the `<script>` it loads and every `<link rel="modulepreload">`
 * it asks for. Dynamic imports - LiveKit, the settings window, the call overlay - are not in
 * there, and must not be: someone reading messages should not download the calling SDK.
 *
 * The numbers below are a ceiling, not a target. They sit above the current measurement so
 * ordinary work does not fail, while something genuinely large does.
 *
 * Run with: npm run check:bundle
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

/**
 * Ceilings for what the browser fetches before the app can draw itself, after gzip.
 *
 * Raised only with a reason: a new limit is a decision that the extra weight is worth it.
 *
 * **Reason for the 200 -> 210 KB raise (account isolation and device sessions):** the first screen
 * grew by ~3 KB gzipped because `useMessenger` itself must now carry the account-scope rules
 * (`accountScope`, `scopedStorage`, `useOwnerStorage`) and the device-session client
 * (`deviceSessions`, `useDeviceSessions`). These cannot be code-split: they are hooks the messenger
 * body calls on every render, not screens opened on demand. The alternative - a lazily loaded
 * sessions list - would put a network round trip in front of the settings screen's "which devices
 * are signed in" answer, and the whole point of that panel is that it reports server truth promptly.
 *
 * The dictionary, which is the genuinely large addition this release (965 KB), was split into its
 * own chunk instead of being absorbed here: `words.data` is now a separate 197 KB-gzip chunk loaded
 * only when the games screen opens. See `scripts/build-dictionary.mjs`. So the honest summary is:
 * the first screen gained a little weight it cannot avoid, and did not gain the weight it could.
 */
const BUDGET = {
  /** Everything the first screen needs, compressed - what a phone downloads on a cold start. */
  firstScreenGzip: 210 * 1024,
  /** The same uncompressed. Catches a dependency that compresses deceptively well. */
  firstScreenRaw: 750 * 1024,
  /** One chunk on its own. Anything above this should be split by feature. */
  maxChunkGzip: 200 * 1024,
};

const failures = [];

function kb(bytes) {
  return Math.round(bytes / 1024) + " КБ";
}

function gzipped(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

if (!existsSync(dist)) {
  console.error("x dist/ отсутствует — сначала выполните npm run build");
  process.exit(1);
}

const html = readFileSync(join(dist, "index.html"), "utf8");

/** The browser's own first-screen list: the entry script and everything it preloads. */
const entryFiles = [
  ...new Set(
    [
      ...html.matchAll(/<script[^>]+src="\/(?:[^"]*\/)?assets\/([^"]+\.js)"/g),
      ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/(?:[^"]*\/)?assets\/([^"]+\.js)"/g),
      ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/(?:[^"]*\/)?assets\/([^"]+\.css)"/g),
    ].map((match) => "assets/" + match[1])
  ),
];

if (entryFiles.length === 0) {
  console.error("x в dist/index.html не найдено ни одного файла первого экрана — сборка неполная");
  process.exit(1);
}

let raw = 0;
let gzip = 0;
const rows = [];
for (const file of entryFiles) {
  const path = join(dist, file);
  if (!existsSync(path)) {
    failures.push("index.html ссылается на " + file + ", а файла нет — сборка неполная");
    continue;
  }
  const bytes = statSync(path).size;
  const compressed = gzipped(path);
  raw += bytes;
  gzip += compressed;
  rows.push({ file, bytes, compressed });
}

console.log("Первая загрузка (до первого экрана):");
for (const row of rows.sort((a, b) => b.bytes - a.bytes)) {
  console.log("  " + row.file.padEnd(44) + kb(row.bytes).padStart(9) + "  (" + kb(row.compressed) + " сжато)");
}
console.log("  " + "итого".padEnd(44) + kb(raw).padStart(9) + "  (" + kb(gzip) + " сжато)");

if (gzip > BUDGET.firstScreenGzip) {
  failures.push(
    "первая загрузка " + kb(gzip) + " сжато — больше бюджета " + kb(BUDGET.firstScreenGzip) +
      ". Обычно причина — тяжёлый импорт, попавший в стартовый чанк: загрузка по требованию через import() и есть ответ."
  );
}
if (raw > BUDGET.firstScreenRaw) {
  failures.push("первая загрузка " + kb(raw) + " несжато — больше бюджета " + kb(BUDGET.firstScreenRaw));
}

let largest = { name: "", size: 0 };
for (const name of readdirSync(join(dist, "assets"))) {
  if (!name.endsWith(".js")) continue;
  const size = gzipped(join(dist, "assets", name));
  if (size > largest.size) largest = { name, size };
  if (size > BUDGET.maxChunkGzip) {
    failures.push("чанк " + name + " весит " + kb(size) + " сжато — больше " + kb(BUDGET.maxChunkGzip) + " на один чанк");
  }
}
console.log("самый крупный чанк: " + largest.name + " — " + kb(largest.size) + " сжато");

if (failures.length > 0) {
  for (const message of failures) console.error("x " + message);
  process.exit(1);
}

console.log("OK: размеры сборки в бюджете");
