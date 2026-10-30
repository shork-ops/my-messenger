import { expect, test } from "@playwright/test";

/**
 * Stickers.
 *
 * A sticker is a message whose body is a marker and an id, drawn from the bundle. The tests
 * check the three things that would make it useless: it must be findable, it must arrive as
 * a sticker rather than as its id in plain text, and it must stay readable to a screen reader.
 */

test.describe("stickers", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("the picker offers the whole pack and narrows by search", async ({ page }) => {
    await page.getByLabel("Стикеры").click();
    const picker = page.getByRole("dialog", { name: "Стикеры" });
    await expect(picker).toBeVisible();

    const all = await picker.locator(".sticker-item").count();
    expect(all).toBeGreaterThanOrEqual(24);

    await page.getByLabel("Найти стикер").fill("привет");
    await expect(picker.locator(".sticker-item")).toHaveCount(1);
    await expect(picker.locator(".sticker-item").first()).toHaveAttribute("aria-label", "Стикер: Привет");

    // A word nobody would use as a sticker tag finds nothing rather than everything.
    await page.getByLabel("Найти стикер").fill("квантовая хромодинамика");
    await expect(picker.locator(".sticker-item")).toHaveCount(0);
  });

  test("sending a sticker puts the sticker in the conversation, not its id", async ({ page }) => {
    await page.getByLabel("Стикеры").click();
    const picker = page.getByRole("dialog", { name: "Стикеры" });
    await picker.locator(".sticker-item").first().click();

    const bubble = page.locator(".message-line").last();
    await expect(bubble.locator(".message-sticker")).toBeVisible();
    // The id must never surface as text: a reader seeing "sticker:hi" would think the app
    // broke.
    await expect(bubble).not.toContainText("sticker");
    await expect(page.getByRole("dialog", { name: "Стикеры" })).toBeHidden();
  });

  test("a sticker is announced rather than shown as a bare glyph", async ({ page }) => {
    await page.getByLabel("Стикеры").click();
    await page.getByRole("dialog", { name: "Стикеры" }).locator(".sticker-item").first().click();

    const sticker = page.locator(".message-line").last().locator(".message-sticker");
    await expect(sticker).toHaveAttribute("role", "img");
    await expect(sticker).toHaveAttribute("aria-label", /^Стикер: /);
  });

  test("the picker closes on Escape", async ({ page }) => {
    await page.getByLabel("Стикеры").click();
    await expect(page.getByRole("dialog", { name: "Стикеры" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Стикеры" })).toBeHidden();
  });
});
