import { expect, test } from "@playwright/test";

/**
 * «Анти-ссора»: a shouted message stops for a moment before it leaves.
 *
 * What only a browser shows: that the send is really held back - nothing appears in the chat
 * until a choice is made - and that the softened text lands in the composer, not in the chat.
 */
const LOUD = "ТЫ ОПЯТЬ НЕ ПРИШЁЛ!!! Я ЖДАЛА ЧАС";
const COOLED = "Ты опять не пришёл! Я ждала час";

test.describe("cool-down before a shouted message", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.locator(".chat-list .chat-row", { hasText: "Максим" }).first().click();
  });

  test("holds the message, cools it into the composer, and then sends what was chosen", async ({ page }) => {
    const field = page.getByLabel("Текст сообщения");
    await field.fill(LOUD);
    await page.getByRole("button", { name: "Отправить сообщение" }).click();

    const sheet = page.getByRole("dialog", { name: "Сообщение раскалено" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("meter", { name: "Накал" })).toHaveAttribute("aria-valuetext", /^\d\d°$/);
    await expect(page.locator(".message-line", { hasText: LOUD })).toHaveCount(0);

    await sheet.getByRole("button", { name: /Остудить/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect(field).toHaveValue(COOLED);
    await expect(page.getByText(/Остыло до 38,6°/)).toBeVisible();

    // The softened text goes on the next press without asking again.
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.locator(".message-line").last()).toContainText(COOLED);
  });

  test("sends as it was when that is the choice", async ({ page }) => {
    await page.getByLabel("Текст сообщения").fill(LOUD);
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Отправить как есть/ }).click();
    await expect(page.locator(".message-line").last()).toContainText(LOUD);
  });

  test("three words in capitals are not shouting, and switching it off is remembered", async ({ page }) => {
    const field = page.getByLabel("Текст сообщения");
    await field.fill("ТЫ ОПЯТЬ ОПОЗДАЛ, ну что ж");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".message-line").last()).toContainText("ТЫ ОПЯТЬ ОПОЗДАЛ");

    await field.fill(LOUD);
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Больше не предлагать" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(field).toHaveValue(LOUD);

    await page.reload();
    await page.locator(".chat-list .chat-row", { hasText: "Максим" }).first().click();
    await page.getByLabel("Текст сообщения").fill("А ТЕПЕРЬ ЭТО ПРОСТО КАПС");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".message-line").last()).toContainText("А ТЕПЕРЬ ЭТО ПРОСТО КАПС");
  });
});
