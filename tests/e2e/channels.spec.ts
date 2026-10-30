import { expect, test } from "@playwright/test";

/**
 * Channels, from the subscriber's side.
 *
 * The rule that justifies the whole feature: a reader cannot post. What makes that hard to get
 * right is not hiding the button - it is that the reader must not be given a reply box and
 * then told no. So the test checks the reply box is absent, not merely disabled.
 */

test.describe("channels", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.getByText("Заметки о походах").first().click();
    await expect(page.locator(".conversation-title strong")).toContainText("Заметки о походах");
  });

  test("a subscriber gets no composer at all, and is told why", async ({ page }) => {
    await expect(page.locator(".composer")).toHaveCount(0);
    await expect(page.getByRole("note")).toContainText("Писать могут только его авторы");
    // The text box itself is gone, so there is nothing to type into by accident.
    await expect(page.getByLabel("Текст сообщения")).toHaveCount(0);
  });

  test("a channel is marked wherever its name is shown", async ({ page }) => {
    await expect(page.locator(".conversation-title .channel-badge")).toHaveCount(1);
  });

  test("a channel shows what it says about itself, not who is online", async ({ page }) => {
    // Nobody is "online" on behalf of a channel: the description is the useful line here.
    await expect(page.locator(".conversation-title small")).toHaveText(
      "Маршруты, снаряжение и честные отчёты о погоде"
    );
  });

  test("formatting and spoilers work in a channel's posts", async ({ page }) => {
    await expect(page.locator(".markup-bold").first()).toHaveText("Маршрут на выходные");
    const spoiler = page.locator(".markup-spoiler").last();
    await expect(spoiler).toHaveAttribute("aria-expanded", "false");
    await spoiler.click();
    await expect(spoiler).toHaveAttribute("aria-expanded", "true");
  });

  test("an ordinary chat still has its composer", async ({ page }) => {
    // The channel rule must not leak into normal conversations. The chat is reached through
    // the list rather than the back button, which behaves differently at narrow widths.
    await page.locator(".chat-row").filter({ hasText: "Аня" }).first().click();
    await expect(page.locator(".conversation-title strong")).toContainText("Аня");
    await expect(page.locator(".composer")).toBeVisible();
    await expect(page.getByLabel("Текст сообщения")).toBeVisible();
  });

  test("a subscriber cannot attach a file either", async ({ page }) => {
    // Hiding the composer is not enough if the file input is still reachable in the page.
    await expect(page.locator("input.hidden-file-input")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Прикрепить" })).toHaveCount(0);
  });

  test("the chat list marks the channel before it is opened", async ({ page }) => {
    const row = page.locator(".chat-row").filter({ hasText: "Заметки о походах" });
    await expect(row.first()).toBeVisible();
    // A channel's own colour marks it in the list, so the reader knows before opening it
    // that writing there is not possible.
    await expect(row.first().locator(".channel-badge, .chat-channel-mark")).toHaveCount(1);
  });
});
