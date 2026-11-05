import { expect, test } from "@playwright/test";

/**
 * «Огонёк дружбы» in the demo: Максим and the reader have written to each other six days in a
 * row, and today only Максим has written so far. The browser test is for what a person sees -
 * the dimmed fire in the list, the card that says whose turn it is, and the bonfire that
 * appears the moment the reader answers.
 */
test.describe("friendship streaks", () => {
  test.beforeEach(async ({ page }) => {
    // Badge variants depend on the hour; keep this daytime scenario deterministic.
    await page.clock.setFixedTime(new Date(2026,10,5,12,0,0));
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("grows into a bonfire when the reader answers today", async ({ page }) => {
    const row = page.locator(".chat-list .chat-row", { hasText: "Максим" }).first();
    await expect(row.locator(".streak-badge.pending")).toHaveText("🔥6");

    await row.click();
    const chip = page.locator(".streak-chip");
    await expect(chip).toHaveText("🔥6");
    await expect(chip).toHaveClass(/pending/);

    await chip.click();
    const card = page.getByRole("dialog", { name: "Огонёк дружбы" });
    await expect(card).toContainText("6 дней подряд");
    await expect(card).toContainText("ваша очередь");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);

    await page.getByLabel("Текст сообщения").fill("Привет! Всё отлично");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByText("🏕️ Костёр! 7 дней подряд в чате «Максим»")).toBeVisible();
    await expect(chip).toHaveText("🏕️7");
    await expect(chip).not.toHaveClass(/pending/);
    await expect(row.locator(".streak-badge")).toHaveText("🏕️7");
  });

  test("a group has no streak", async ({ page }) => {
    await page.locator(".chat-list .chat-row", { hasText: "Команда" }).first().click();
    await expect(page.locator(".conversation-title strong")).toContainText("Команда");
    await expect(page.locator(".streak-chip")).toHaveCount(0);
  });
});
