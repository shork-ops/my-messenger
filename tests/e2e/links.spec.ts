import { expect, test } from "@playwright/test";

/**
 * Links in messages.
 *
 * A body is written by whoever sent it, so this suite is as much about what must *not* become
 * a link as about what must. A message that could put `javascript:` in an href would be a
 * script injection with extra steps.
 */

test.describe("links", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  /**
   * Sends a message and returns its bubble.
   *
   * The visible text is not compared with the typed text: markup collapses (**важно** reads
   * as "важно"), so the message is identified by the newest line being mine instead.
   */
  async function send(page: Parameters<typeof test>[1]["page"], text: string) {
    const before = await page.locator(".message-line").count();
    await page.getByLabel("Текст сообщения").fill(text);
    await page.getByLabel("Отправить сообщение").click();
    await expect(page.locator(".message-line")).toHaveCount(before + 1);
    await page.waitForTimeout(300);
    return page.locator(".message-line").last();
  }

  test("an address in a message becomes a link that opens elsewhere", async ({ page }) => {
    const line = await send(page, "смотри https://example.com/page тут");
    const link = line.locator("a.message-link");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "https://example.com/page");
    // Opening in the same tab would navigate away from the conversation.
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("a bare domain is linked without the scheme", async ({ page }) => {
    const line = await send(page, "зайди на example.com пожалуйста");
    await expect(line.locator("a.message-link")).toHaveAttribute("href", "https://example.com");
  });

  test("a javascript: URL stays text", async ({ page }) => {
    const line = await send(page, "javascript:alert(1)");
    await expect(line.locator("a")).toHaveCount(0);
  });

  test("a full stop at the end of a sentence is not part of the link", async ({ page }) => {
    const line = await send(page, "открой https://example.com/a.");
    await expect(line.locator("a.message-link")).toHaveAttribute("href", "https://example.com/a");
  });

  test("markup still applies around a link", async ({ page }) => {
    const line = await send(page, "**важно: https://example.com/x**");
    await expect(line.locator("a.message-link")).toHaveCount(1);
    await expect(line.locator(".markup-bold")).toHaveCount(1);
  });

  test("the demo does not invent a preview card", async ({ page }) => {
    // A card needs the edge function and a signed-in session. Drawing a made-up one would
    // make the demo claim a network call that never happened.
    const line = await send(page, "https://example.com/story");
    await expect(line.locator("a.message-link")).toHaveCount(1);
    await expect(line.locator(".link-card")).toHaveCount(0);
  });
});
