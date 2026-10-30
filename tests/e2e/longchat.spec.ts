import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * A very long conversation.
 *
 * The window is a fix for a measured problem: five thousand messages put sixty thousand
 * elements in the page and took two and a half seconds to open. What makes it worth a browser
 * test rather than unit tests only is the failure mode - a window that gets the arithmetic
 * right but loses the reader's place, which is the bug this project has hit several times in
 * scrolling.
 *
 * These drive the wheel rather than setting scrollTop, because that is what a reader does.
 */

async function state(page: Page) {
  return page.evaluate(() => {
    const area = document.querySelector(".messages-area");
    const lines = Array.from(document.querySelectorAll(".message-line"));
    const rect = area ? area.getBoundingClientRect() : null;
    const onScreen = rect
      ? lines.filter((node) => {
          const item = node.getBoundingClientRect();
          return item.bottom > rect.top + 2 && item.top < rect.bottom;
        })
      : [];
    const number = (node: Element | undefined) => Number((node?.textContent ?? "").match(/(\d{1,4})\./)?.[1] ?? 0);
    return {
      rendered: lines.length,
      firstVisible: number(onScreen[0]),
      lastVisible: number(onScreen[onScreen.length - 1]),
      atEnd: area ? area.scrollHeight - area.clientHeight - area.scrollTop <= 4 : false,
    };
  });
}

async function wheel(
  page: Page,
  deltaY: number,
  until: (current: Awaited<ReturnType<typeof state>>) => boolean,
  budgetMs = 120_000
) {
  const deadline = Date.now() + budgetMs;
  await page.mouse.move(550, 450);
  while (Date.now() < deadline) {
    for (let index = 0; index < 5; index += 1) {
      await page.mouse.wheel(0, deltaY);
      await page.waitForTimeout(10);
    }
    await page.waitForTimeout(80);
    if (until(await state(page))) return;
  }
  throw new Error("прокрутка не дошла до нужного места");
}

test.describe("a very long conversation", () => {
  // Walking five thousand messages with the wheel is slow on purpose: every step is a real
  // scroll event.
  test.describe.configure({ timeout: 180_000 });

  test("opens at the end without rendering the whole history", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.getByText("Очень длинный чат").first().click();
    await expect(page.locator(".message-line").last()).toContainText("сообщение 5000.");

    const current = await state(page);
    // The point of the window: a slice in the DOM, not five thousand messages.
    expect(current.rendered).toBeLessThan(300);
    expect(current.rendered).toBeGreaterThan(0);
    expect(current.lastVisible).toBe(5000);
    expect(current.atEnd).toBe(true);
  });

  test("scrolling to the top reaches the first message", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.getByText("Очень длинный чат").first().click();
    await expect(page.locator(".message-line").last()).toContainText("сообщение 5000.");

    await wheel(page, -1500, (current) => current.firstVisible <= 2);
    const current = await state(page);
    expect(current.firstVisible).toBeLessThanOrEqual(2);
    // Reaching the top must not leave every message rendered: that is what the window is for.
    expect(current.rendered).toBeLessThan(300);
  });

  test("going back down lands at the end again", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.getByText("Очень длинный чат").first().click();
    await expect(page.locator(".message-line").last()).toContainText("сообщение 5000.");

    await wheel(page, -1500, (current) => current.firstVisible <= 2);
    await wheel(page, 1500, (current) => current.lastVisible === 5000 && current.atEnd);
    const current = await state(page);
    expect(current.lastVisible).toBe(5000);
    expect(current.atEnd).toBe(true);
  });

  test("reopening a chat after leaving it at the top still opens at the end", async ({ page }) => {
    // The window decides which messages to render from the scroll ratio, and the ratio belongs
    // to the conversation that produced it. Carried into the next one it decided the window
    // before anything had been measured, so a chat left at the top opened the next chat at the
    // top as well: the first messages were rendered instead of the last, the scroll height
    // collapsed from 360 483 to 3 380, and there was no way to scroll to the end.
    await page.goto("/my-messenger/");
    await page.getByText("Очень длинный чат").first().click();
    await expect(page.locator(".message-line").last()).toContainText("сообщение 5000.");

    await wheel(page, -1500, (current) => current.firstVisible <= 2);
    expect((await state(page)).firstVisible).toBeLessThanOrEqual(2);

    // Leave for a short conversation and come back.
    await page.getByText("Аня").first().click();
    await expect(page.locator(".message-line")).toHaveCount(2);
    await page.getByText("Очень длинный чат").first().click();

    await expect(page.locator(".message-line").last()).toContainText("сообщение 5000.");
    const reopened = await state(page);
    expect(reopened.lastVisible).toBe(5000);
    expect(reopened.atEnd).toBe(true);
    // The history is still reachable, not truncated to the slice that was on screen.
    const reachable = await page.evaluate(() => {
      const area = document.querySelector(".messages-area");
      return area ? Math.round(area.scrollHeight - area.clientHeight) : 0;
    });
    expect(reachable).toBeGreaterThan(100_000);
  });

  test("a short conversation still renders every message", async ({ page }) => {
    // The window exists for a measured problem; applying it to a chat of a few messages would
    // trade a real risk for no gain.
    await page.goto("/my-messenger/");
    await page.getByText("Аня").first().click();
    await expect(page.locator(".message-line")).toHaveCount(2);
    await expect(page.locator(".window-spacer")).toHaveCount(0);
  });
});
