import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/my-messenger/");
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("Shift+Enter adds a line, Enter sends, and the composer shrinks again", async ({ page }) => {
  const field = page.getByLabel("Текст сообщения");
  await field.fill("Первая строка");
  const initial = (await field.boundingBox())!.height;
  await field.press("End");
  await field.press("Shift+Enter");
  await field.pressSequentially("Вторая строка");
  await expect(field).toHaveValue("Первая строка\nВторая строка");
  expect((await field.boundingBox())!.height).toBeGreaterThan(initial);
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await expect(page.locator(".message-line").last()).toContainText("Вторая строка");
  await expect(page.locator(".message-line").last().locator(".message-body")).toHaveCSS("white-space", "pre-wrap");
  await expect.poll(async () => (await field.boundingBox())!.height).toBe(initial);
});

test("right click opens actions without changing pin state; Escape restores focus", async ({ page }) => {
  const row = page.locator(".chat-list .chat-row").first();
  const pinned = await row.locator(".pinned-mark").count();
  await row.click({ button: "right" });
  const menu = page.locator(".chat-row-menu");
  await expect(menu).toBeVisible();
  await expect(row.locator(".pinned-mark")).toHaveCount(pinned);
  await expect(menu.getByRole("button", { name: pinned ? "Открепить" : "Закрепить", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(row).toBeFocused();
});

test("compact composer stays inside a phone viewport and offers stickers and video", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".chat-list .chat-row").first().click();
  await expect(page.locator(".rail")).toBeHidden();
  await expect(page.locator(".mobile-bottom-nav")).toBeHidden();
  expect((await page.locator(".conversation-panel").boundingBox())!.x).toBe(0);
  const field = page.getByLabel("Текст сообщения");
  await field.fill("Мобильный черновик");
  await field.press("Enter");
  await expect(field).toHaveValue("Мобильный черновик\n");
  await field.fill("");
  const composer = page.locator(".composer");
  const box = (await composer.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect((await page.getByLabel("Текст сообщения").boundingBox())!.width).toBeGreaterThan(75);
  await page.getByLabel("Эмодзи и стикеры", { exact: true }).click();
  await expect(page.getByLabel("Стикеры", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("Прикрепить", { exact: true }).click();
  await expect(page.getByLabel("Записать видеозаметку", { exact: true })).toBeVisible();
});
