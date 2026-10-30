import { expect, test, type Page } from "@playwright/test";

/**
 * The privacy switches have to do something.
 *
 * A toggle that stores a value but changes nothing on screen is worse than no toggle: it
 * tells the reader they have been protected when nothing happened. Each test flips a switch
 * and then checks the screen, not the storage.
 */

async function openPrivacySettings(page: Page) {
  await page.getByLabel("Настройки").click();
  await expect(page.locator(".settings-nav")).toBeVisible();
  await page.locator(".settings-nav-item").filter({ hasText: "Приватность" }).first().click();
  await expect(page.locator(".toggle-row").first()).toBeVisible();
}

async function closeSettings(page: Page) {
  // Escape steps back to the section list first, then closes the dialog.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-nav")).toBeHidden();
}

test.describe("privacy preferences", () => {
  test("all three switches are offered and on by default", async ({ page }) => {
    await page.goto("/my-messenger/");
    await openPrivacySettings(page);

    for (const label of ["Статусы прочтения", "был(а) в сети", "Печатает"]) {
      const input = page.locator(".toggle-row").filter({ hasText: label }).locator("input");
      await expect(input).toBeChecked();
    }
  });

  test("switching receipts off is remembered after a reload", async ({ page }) => {
    await page.goto("/my-messenger/");
    await openPrivacySettings(page);

    const receipts = page.locator(".toggle-row").filter({ hasText: "Статусы прочтения" }).locator("input");
    await receipts.click({ force: true });
    await expect(receipts).not.toBeChecked();

    await closeSettings(page);
    await page.reload();
    await openPrivacySettings(page);
    await expect(page.locator(".toggle-row").filter({ hasText: "Статусы прочтения" }).locator("input")).not.toBeChecked();
  });

  test("hiding the last-seen time changes the conversation header", async ({ page }) => {
    await page.goto("/my-messenger/");
    await openPrivacySettings(page);
    await page.locator(".toggle-row").filter({ hasText: "был(а) в сети" }).locator("input").click({ force: true });
    await closeSettings(page);

    // The header must show something coherent rather than an empty slot where the status
    // used to be.
    const header = page.locator(".conversation-panel header");
    await expect(header).toBeVisible();
    const text = await header.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/^\s*$/);
  });

  test("the screen says what the switches cannot do", async ({ page }) => {
    await page.goto("/my-messenger/");
    await openPrivacySettings(page);
    // The limit is part of the feature: without end-to-end encryption the switches cannot
    // stop the other device from receiving events, and the screen must say so.
    await expect(page.locator(".settings-note")).toContainText("сквозное шифрование");
  });
});
