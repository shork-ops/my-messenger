import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
await page.goto("http://127.0.0.1:5174/my-messenger/?u=" + Math.random(), { waitUntil: "networkidle", timeout: 90000 });
await page.waitForSelector(".chat-row", { timeout: 30000 });
await page.waitForTimeout(1000);
const composer = page.locator('.composer input[aria-label="Текст сообщения"]');
await composer.fill("вернуть-меня");
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
await page.locator(".message-line").last().hover();
await page.locator(".message-menu-toggle").last().click();
await page.waitForTimeout(400);
await page.locator('[aria-label="Удалить у всех"]').click();
await page.waitForTimeout(800);
const undo = page.locator('button:has-text("Отменить")').first();
console.log("undo exists:", await undo.count(), "| visible:", await undo.isVisible().catch(() => false));
await undo.click();
await page.waitForTimeout(400);
console.log("immediately after click, rows with text:", await page.locator(".messages-area .message-line").evaluateAll((n) => n.filter((x) => (x.querySelector(".bubble")?.textContent || "").includes("вернуть-меня")).length));
for (const ms of [400, 800, 1500, 2500]) {
  await page.waitForTimeout(ms);
  const n = await page.locator(".messages-area .message-line").evaluateAll((nodes) => nodes.filter((x) => (x.querySelector(".bubble")?.textContent || "").includes("вернуть-меня")).length);
  const toast = await page.locator('[class*="toast"], [role="status"]').allTextContents();
  console.log("+" + ms + "ms: rows", n, "| toast:", JSON.stringify(toast.slice(0, 1)));
}
await browser.close();
