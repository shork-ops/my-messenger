import { expect, test } from "@playwright/test";

/**
 * Phase 0 smoke suite: the loop that must never break.
 * Runs against the demo build, so it needs no backend and no credentials.
 */
test.describe("Nexus messenger smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("launches with the chat list and an open conversation", async ({ page }) => {
    await expect(page.locator(".chat-list-panel")).toBeVisible();
    await expect(page.locator(".rail")).toBeVisible();

    const chats = page.locator(".chat-list .chat-row");
    await expect(chats.first()).toBeVisible();
    expect(await chats.count()).toBeGreaterThan(1);

    // A conversation is selected on first paint, so the composer is ready.
    await expect(page.getByLabel("Текст сообщения")).toBeVisible();
  });

  test("switches the active conversation when another chat is clicked", async ({ page }) => {
    const chats = page.locator(".chat-list .chat-row");
    const second = chats.nth(1);
    const name = (await second.locator(".chat-row-copy strong").innerText()).trim();
    await second.click();

    await expect(second).toHaveClass(/selected/);
    await expect(page.locator(".conversation-panel")).toContainText(name);
  });

  test("sends a message from the composer", async ({ page }) => {
    const text = `smoke ${Date.now()}`;
    const composer = page.getByLabel("Текст сообщения");
    await composer.fill(text);
    await page.getByLabel("Отправить сообщение").click();

    await expect(page.locator(".messages-area")).toContainText(text);
    // The composer is cleared once the message is accepted.
    await expect(composer).toHaveValue("");
  });

  test("opens the message menu and offers a reaction", async ({ page }) => {
    const text = `reaction ${Date.now()}`;
    await page.getByLabel("Текст сообщения").fill(text);
    await page.getByLabel("Отправить сообщение").click();

    const line = page.locator(".message-line").filter({ hasText: text }).last();
    await expect(line).toBeVisible();
    await line.getByLabel("Действия с сообщением").click();

    // Reactions are stored in Supabase and need a remote message id. The demo
    // build has none, so clicking must explain the limitation instead of
    // silently doing nothing — that behaviour is what this test pins down.
    await expect(line.getByRole("button", { name: "❤️" })).toBeVisible();
    await line.getByRole("button", { name: "❤️" }).click();
    await expect(page.getByText("Реакции доступны в облачных сообщениях")).toBeVisible();
  });

  test("forwards a message and keeps a copy in favourites", async ({ page }) => {
    const text = `forward ${Date.now()}`;
    await page.getByLabel("Текст сообщения").fill(text);
    await page.getByLabel("Отправить сообщение").click();

    const line = page.locator(".message-line").filter({ hasText: text }).last();
    await expect(line).toBeVisible();
    await line.getByLabel("Действия с сообщением").click();
    await line.getByLabel("Сохранить в избранное").click();

    // The favourites chat appears in the list and holds the saved copy.
    const favourites = page.locator(".chat-list .chat-row").filter({ hasText: "Избранное" });
    await expect(favourites).toBeVisible();
    await favourites.click();
    await expect(page.locator(".messages-area")).toContainText(text);
  });

  test("pins a message from the menu", async ({ page }) => {
    const text = `pin ${Date.now()}`;
    await page.getByLabel("Текст сообщения").fill(text);
    await page.getByLabel("Отправить сообщение").click();

    const line = page.locator(".message-line").filter({ hasText: text }).last();
    await line.getByLabel("Действия с сообщением").click();
    await line.getByLabel("Закрепить сообщение").click();

    await expect(page.getByText("Сообщение закреплено")).toBeVisible();
  });

  test("opens message actions on a long press", async ({ page }) => {
    const line = page.locator(".message-line").first();
    const box = await line.boundingBox();
    if (!box) throw new Error("no message on screen");

    // A short tap must leave the menu closed.
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(page.locator(".message-actions")).toHaveCount(0);

    // Holding past the threshold opens it.
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    const openedDuringHold = (await page.locator(".message-actions").count()) > 0;
    await page.mouse.up();
    expect(openedDuringHold).toBe(true);
    await expect(page.locator(".message-actions")).toBeVisible();
  });

  test("opens the privacy settings", async ({ page }) => {
    // Below 1440px the profile panel is a drawer, so open it first.
    const panel = page.locator(".right-panel");
    if (!(await panel.isVisible())) {
      await page.getByRole("button", { name: "Профиль", exact: true }).click();
      await expect(panel).toBeVisible();
    }
    await page.getByText("Приватность и блокировки").click();
    const modal = page.locator(".privacy-modal");
    await expect(modal).toBeVisible();

    // Both switches start off: nothing is hidden until the user asks.
    const switches = modal.locator(".privacy-row input");
    await expect(switches).toHaveCount(2);
    for (const checkbox of await switches.all()) await expect(checkbox).not.toBeChecked();

    await expect(modal.locator(".danger-button")).toHaveText(/Удалить аккаунт/);
  });

  test("filters the chat list by the search box", async ({ page }) => {
    const chats = page.locator(".chat-list .chat-row");
    const before = await chats.count();

    await page.getByPlaceholder(/Поиск чатов/).fill("щщщщнеттакого");
    await expect(chats).toHaveCount(0);

    await page.getByPlaceholder(/Поиск чатов/).fill("");
    await expect.poll(() => chats.count()).toBe(before);
  });

  test("explains that calls need a cloud chat", async ({ page }) => {
    // Demo chats have no remoteId, so there is nothing to signal. The button
    // must say so instead of doing nothing or opening a stuck overlay.
    await page.getByLabel("Позвонить").click();

    await expect(page.getByText("Звонки доступны в облачных чатах")).toBeVisible();
    await expect(page.locator(".call-overlay")).toHaveCount(0);
  });
});
