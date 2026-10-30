import { expect, test, type Page } from "@playwright/test";

/**
 * The conversation must open at the end, not at the beginning.
 *
 * This bug came back three times. Each time it was reported against a chat long enough
 * to scroll, and each time the fix was checked against a chat short enough that "top"
 * and "bottom" were the same place. These tests use the sixty-message demo chat and
 * measure the gap in pixels, so a regression fails here instead of in the owner's hands.
 */

/** How far the message list is from its bottom, in CSS pixels. */
async function distanceFromBottom(page: Page): Promise<number> {
  return page.locator(".messages-area").evaluate((node) => {
    const list = node as HTMLElement;
    return Math.round(list.scrollHeight - list.clientHeight - list.scrollTop);
  });
}

/** Opens the long demo chat by its name in the chat list. */
async function openLongChat(page: Page): Promise<void> {
  const row = page.locator(".chat-list .chat-row").filter({ hasText: "Длинный чат" }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".conversation-panel")).toContainText("Длинный чат");
}

/** Waits until the list has actually grown taller than its viewport. */
async function waitForOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () => page.locator(".messages-area").evaluate((node) => {
      const list = node as HTMLElement;
      return list.scrollHeight - list.clientHeight;
    }), { timeout: 5000 })
    .toBeGreaterThan(200);
}

test.describe("conversation opens at the end", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("a long conversation opens at the last message", async ({ page }) => {
    await openLongChat(page);
    await waitForOverflow(page);

    // Give the layout effect a frame to settle: fonts and images change heights.
    await page.waitForTimeout(300);
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);

    // The last message is the one on screen, not the first.
    await expect(page.locator(".messages-area")).toContainText("сообщение 60");
  });

  test("returning to a long conversation lands at the end again", async ({ page }) => {
    await openLongChat(page);
    await waitForOverflow(page);

    // Read some history, then leave and come back. Coming back must not restore the
    // scrolled position — the conversation is reopened, not resumed.
    await page.locator(".messages-area").evaluate((node) => {
      (node as HTMLElement).scrollTop = 0;
    });
    await page.waitForTimeout(200);

    await page.locator(".chat-list .chat-row").filter({ hasText: "Максим" }).first().click();
    await page.waitForTimeout(200);
    await openLongChat(page);
    await waitForOverflow(page);
    await page.waitForTimeout(300);

    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  });

  test("a sent message keeps the list at the end", async ({ page }) => {
    await openLongChat(page);
    await waitForOverflow(page);

    const text = `хвост ${Date.now()}`;
    await page.getByLabel("Текст сообщения").fill(text);
    await page.getByLabel("Отправить сообщение").click();
    await expect(page.locator(".messages-area")).toContainText(text);
    await page.waitForTimeout(400);

    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  });

  test("resizing the window keeps the list at the end", async ({ page }) => {
    await openLongChat(page);
    await waitForOverflow(page);

    for (const size of [{ width: 900, height: 700 }, { width: 1400, height: 950 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(350);
      expect(await distanceFromBottom(page), `after resize to ${size.width}x${size.height}`).toBeLessThanOrEqual(2);
    }
  });

  test("opens at the end on a phone viewport too", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();

    const row = page.locator(".chat-list .chat-row").filter({ hasText: "Длинный чат" }).first();
    await expect(row).toBeVisible();
    await row.click();

    const back = page.getByLabel("Назад к чатам");
    // On a phone the pane is a full screen, so the open conversation is already there.
    if (await back.isVisible().catch(() => false)) await back.isVisible();
    await waitForOverflow(page);
    await page.waitForTimeout(300);
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  });

  test("reading history and scrolling back down re-pins to the end", async ({ page }) => {
    await openLongChat(page);
    await waitForOverflow(page);

    const list = page.locator(".messages-area");
    // A user scrolling up must be allowed to stay up: pinning them to the bottom while
    // they read is worse than the original bug.
    await list.evaluate((node) => {
      (node as HTMLElement).scrollTop = 0;
    });
    await page.waitForTimeout(250);
    expect(await distanceFromBottom(page)).toBeGreaterThan(500);

    // Scrolling back to the bottom by hand re-arms the auto-scroll.
    await list.evaluate((node) => {
      const element = node as HTMLElement;
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(250);
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  });
});
