import { expect, test } from "@playwright/test";

/**
 * Hidden messages: sent covered with dust, opened by the reader's tap, as in Telegram.
 * The browser test is for what only a browser shows - that the letters are really drawn
 * transparent, and that the chat list next to the conversation names the message instead of
 * quoting it.
 */
test.describe("hidden messages", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("goes out covered, opens on a tap, and the chat list does not give it away", async ({ page }) => {
    await page.locator(".chat-list .chat-row").first().click();
    await page.getByLabel("Прикрепить", { exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: /Скрытое сообщение/ }).click();
    await expect(page.locator(".hidden-banner")).toBeVisible();

    const field = page.getByLabel("Текст сообщения");
    await field.fill("Пароль от wi-fi: kotik2026");
    await field.press("Enter");
    // One message is hidden, not every message from now on.
    await expect(page.locator(".hidden-banner")).toHaveCount(0);

    const cover = page.locator(".message-line").last().locator(".hidden-message");
    await expect(cover).toHaveClass(/covered/);
    await expect(cover.locator(".hidden-ink")).toHaveCSS("-webkit-text-fill-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".chat-list .chat-row", { hasText: "Скрытое сообщение" })).toHaveCount(1);
    await expect(page.locator(".chat-list")).not.toContainText("kotik2026");

    await cover.click();
    await expect(page.locator(".message-line").last().locator(".hidden-message.open")).toContainText(
      "Пароль от wi-fi: kotik2026"
    );
  });

  test("an inline spoiler is covered with the same dust, not left as a blank gap", async ({ page }) => {
    await page.locator(".chat-list .chat-row").first().click();
    const field = page.getByLabel("Текст сообщения");
    await field.fill("Убийца — ||дворецкий||");
    await field.press("Enter");
    const spoiler = page.locator(".message-line").last().locator(".markup-spoiler");
    await expect(spoiler).toHaveCSS("-webkit-text-fill-color", "rgba(0, 0, 0, 0)");
    expect(await spoiler.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("radial-gradient");
    await spoiler.click();
    await expect(spoiler).toHaveAttribute("aria-expanded", "true");
    expect(await spoiler.evaluate((node) => getComputedStyle(node).backgroundImage)).toBe("none");
  });
});
