import { expect, test, type Page } from "@playwright/test";

/**
 * The date floating over a scrolled conversation.
 *
 * It is written straight into the page while scrolling, which only a browser can check: the
 * label has to name the day of the message right under it, show only while the reader
 * scrolls, and stay away at the end of the list where the newest messages are.
 */

/** The day of the first message whose bottom is below the floating label, read from the page. */
async function dayUnderLabel(page: Page) {
  return page.evaluate(() => {
    const pill = document.querySelector(".sticky-date span");
    if (!pill) return null;
    const top = pill.getBoundingClientRect().top;
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-window-item]"));
    const item = items.find((node) => (node.firstElementChild?.getBoundingClientRect().bottom ?? 0) > top);
    return item?.dataset.day ?? null;
  });
}

async function wheel(page: Page, deltaY: number, steps: number) {
  await page.mouse.move(550, 450);
  for (let index = 0; index < steps; index += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(30);
  }
}

test.describe("floating date", () => {
  test("names the day being read and hides when scrolling stops", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.getByText("Очень длинный чат").first().click();
    await expect(page.locator(".message-line").last()).toContainText("сообщение 5000.");

    const chip = page.locator(".sticky-date");
    // Opening a chat is not scrolling: nothing floats over the newest messages.
    await expect(chip).not.toHaveClass(/shown/);

    // A real date divider right under the label hides it, so if a scroll happens to stop
    // there, scroll a little more rather than fail on a coincidence.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await wheel(page, -400, 6);
      if (await chip.evaluate((node) => node.classList.contains("shown"))) break;
    }
    await expect(chip).toHaveClass(/shown/);
    const day = await dayUnderLabel(page);
    expect(day).toBeTruthy();
    await expect(chip).toHaveText(day!);

    // A moment after the wheel stops, the label goes away by itself.
    await expect(chip).not.toHaveClass(/shown/, { timeout: 4_000 });

    // Back at the end of the list it stays hidden even though the reader just scrolled.
    await wheel(page, 4_000, 4);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const area = document.querySelector(".messages-area")!;
          return area.scrollHeight - area.clientHeight - area.scrollTop <= 4;
        })
      )
      .toBe(true);
    await expect(chip).not.toHaveClass(/shown/);
  });
});
