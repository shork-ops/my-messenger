import { expect, test, type Page } from "@playwright/test";

/**
 * The message menu has to fit inside the conversation.
 *
 * The thread closes the menu as soon as it scrolls, so any part of the menu outside the
 * visible thread is out of reach: scrolling to it closes the menu. In a short chat the menu of
 * the newest message used to open downwards past the composer, and "Закрепить" and "Удалить"
 * could not be pressed at all.
 */

async function openMenuOnNewMessage(page: Page) {
  const text = `menu ${Date.now()}`;
  await page.getByLabel("Текст сообщения").fill(text);
  await page.getByLabel("Отправить сообщение").click();
  const line = page.locator(".message-line").filter({ hasText: text }).last();
  await line.getByLabel("Действия с сообщением").click();
  await expect(page.locator(".message-actions")).toBeVisible();
  return line;
}

async function boxes(page: Page) {
  return page.evaluate(() => {
    const area = document.querySelector(".messages-area")!.getBoundingClientRect();
    const menu = document.querySelector<HTMLElement>(".message-actions")!;
    const box = menu.getBoundingClientRect();
    return { area: { top: area.top, bottom: area.bottom }, menu: { top: box.top, bottom: box.bottom }, scrolls: menu.scrollHeight > menu.clientHeight + 1 };
  });
}

test.describe("message menu placement", () => {
  test("the newest message's menu fits in a short chat, and its last item works", async ({ page }) => {
    await page.goto("/my-messenger/");
    const line = await openMenuOnNewMessage(page);

    const { area, menu } = await boxes(page);
    expect(menu.top).toBeGreaterThanOrEqual(area.top);
    expect(menu.bottom).toBeLessThanOrEqual(area.bottom);

    await line.getByLabel("Закрепить сообщение").click();
    await expect(page.getByText("Сообщение закреплено")).toBeVisible();
  });

  test("in a low window the menu scrolls inside itself instead of running off", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto("/my-messenger/");
    const line = await openMenuOnNewMessage(page);

    const { area, menu, scrolls } = await boxes(page);
    expect(menu.top).toBeGreaterThanOrEqual(area.top);
    expect(menu.bottom).toBeLessThanOrEqual(area.bottom);
    expect(scrolls).toBe(true);

    // The last item is reached by scrolling the menu, which leaves it open.
    const last = line.getByLabel("Удалить у всех");
    await last.scrollIntoViewIfNeeded();
    await expect(page.locator(".message-actions")).toBeVisible();
    await expect(last).toBeInViewport();
  });
});
