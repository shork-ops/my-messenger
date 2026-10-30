import { expect, test } from "@playwright/test";

/**
 * Unread state is a place, not a decoration.
 *
 * A conversation with unread messages must open at the boundary between read and unread,
 * not at the newest message, and the button that takes a reader back to that boundary must
 * appear only when there is somewhere to go.
 *
 * These tests exist because the divider compared a message id against a timestamp for a
 * while: both are numbers, so nothing complained, and the divider simply never appeared.
 * That is only visible in a conversation tall enough to scroll.
 */

async function openLongChat(page: Parameters<typeof test>[1]["page"]) {
  await page.goto("/");
  await page.locator(".chat-list .chat-row").filter({ hasText: "Длинный чат" }).first().click();
  await expect(page.locator(".unread-divider")).toBeVisible();
}

test.describe("unread boundary", () => {
  test("a conversation with unread messages opens at the divider", async ({ page }) => {
    await openLongChat(page);
    await page.waitForTimeout(600);

    const geometry = await page.locator(".messages-area").evaluate((area) => {
      const divider = document.querySelector(".unread-divider") as HTMLElement | null;
      if (!divider) return null;
      const box = area.getBoundingClientRect();
      const mark = divider.getBoundingClientRect();
      return {
        fromTop: Math.round(mark.top - box.top),
        height: Math.round(box.height),
      };
    });

    expect(geometry).not.toBeNull();
    // The divider lands about a third of the way down, so the message it answers stays in
    // view above it.
    expect(geometry!.fromTop).toBeGreaterThan(geometry!.height * 0.2);
    expect(geometry!.fromTop).toBeLessThan(geometry!.height * 0.5);
  });

  test("the jump button appears above the unread messages", async ({ page }) => {
    await openLongChat(page);
    const button = page.locator(".jump-button");

    // At the divider the unread messages are below the view, so the button is offered.
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-label", /К непрочитанным: \d+/);

    // Scrolling to the end satisfies the promise, so the button withdraws.
    await page.locator(".messages-area").evaluate((area) => {
      area.scrollTop = area.scrollHeight;
    });
    await expect(button).toBeHidden();
  });

  test("the jump button returns to the divider", async ({ page }) => {
    await openLongChat(page);
    const area = page.locator(".messages-area");
    await area.evaluate((element) => {
      element.scrollTop = 0;
    });

    const button = page.locator(".jump-button");
    await expect(button).toBeVisible();
    await button.click();
    await page.waitForTimeout(900);

    const placement = await area.evaluate((element) => {
      const divider = document.querySelector(".unread-divider") as HTMLElement | null;
      if (!divider) return null;
      const box = element.getBoundingClientRect();
      const mark = divider.getBoundingClientRect();
      return { fromTop: Math.round(mark.top - box.top), height: Math.round(box.height) };
    });

    expect(placement).not.toBeNull();
    expect(placement!.fromTop).toBeGreaterThan(0);
    expect(placement!.fromTop).toBeLessThan(placement!.height);
  });

  test("a conversation with nothing unread opens at the end and offers no jump", async ({ page }) => {
    await page.goto("/");
    // The first demo chat is already read, so there is no boundary to land on.
    await page.locator(".chat-list .chat-row").first().click();
    await expect(page.locator(".messages-area")).toBeVisible();
    await page.waitForTimeout(500);

    await expect(page.locator(".unread-divider")).toHaveCount(0);
    await expect(page.locator(".jump-button")).toBeHidden();
  });
});
