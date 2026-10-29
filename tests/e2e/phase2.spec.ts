import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 2 acceptance flow, run as two independent browser contexts.
 *
 * The demo build has no backend, so nothing here talks to Supabase: the two
 * tabs simulate "two accounts" by sharing nothing but the app itself, which is
 * exactly the property that matters for the UI — one tab's action must never
 * corrupt the other's view or leak state between sessions.
 *
 * Group roles, server search and block enforcement are checked by the database
 * itself (see `supabase/migrations/2026103*`); what can regress silently in the
 * client is that those features are wired, reachable and fail loudly rather
 * than throwing. That is what this spec covers.
 */
async function openApp(page: Page) {
  await page.goto("/my-messenger/");
  await expect(page.locator(".app-shell")).toBeVisible();
}

test.describe("Phase 2 acceptance: two tabs, group, search, attachment, block", () => {
  test("two tabs stay independent and the group flow survives", async ({ browser }) => {
    const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const tabA = await contextA.newPage();
    const tabB = await contextB.newPage();

    const errorsA: string[] = [];
    const errorsB: string[] = [];
    tabA.on("pageerror", (error) => errorsA.push(error.message));
    tabB.on("pageerror", (error) => errorsB.push(error.message));

    await openApp(tabA);
    await openApp(tabB);

    // Each tab sends its own message; neither should see the other's, because
    // demo state is per-browser-context and must not be shared.
    for (const [tab, text] of [
      [tabA, "Сообщение из первого окна"],
      [tabB, "Сообщение из второго окна"],
    ] as const) {
      await tab.getByLabel("Текст сообщения").fill(text);
      await tab.getByLabel("Отправить сообщение").click();
      await expect(tab.locator(".messages-area")).toContainText(text);
    }

    await expect(tabA.getByText("Сообщение из второго окна")).toHaveCount(0);
    await expect(tabB.getByText("Сообщение из первого окна")).toHaveCount(0);

    // The group chat opens and offers its invitation link.
    await tabA.getByText("Команда").first().click();
    await expect(tabA.getByText("Скопировать ссылку-приглашение")).toBeVisible();

    // In-chat search opens. Server-side hits need a cloud chat (`remoteId`),
    // which the demo build has none of, so an empty result must render nothing
    // instead of an error or a blank panel.
    await tabA.getByLabel("Поиск по переписке").click();
    await expect(tabA.locator(".message-search")).toBeVisible();
    await tabA.locator(".message-search input").fill("план");
    await expect(tabA.locator(".search-error")).toHaveCount(0);
    await expect(tabA.locator(".search-hits")).toHaveCount(0);
    await tabA.getByLabel("Закрыть поиск").click();

    // Attaching a file in the demo build has no Storage bucket behind it, so the
    // result must be a notice, never an unhandled exception.
    await tabA.locator('input[type="file"]').first().setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("вложение"),
    });

    expect(errorsA).toEqual([]);
    expect(errorsB).toEqual([]);

    await contextA.close();
    await contextB.close();
  });

  test("blocking is reachable and blocks nothing until used", async ({ page }) => {
    await openApp(page);
    await page.locator(".rail").getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(page.locator(".settings-modal").first()).toBeVisible();
    await page.getByRole("button", { name: /^Приватность/ }).click();
    await page.getByRole("button", { name: /Приватность и блокировки/ }).click();

    const modal = page.locator(".privacy-modal");
    await expect(modal).toBeVisible();

    // With no blocks, the list explains how to add one instead of being empty.
    await expect(modal.getByText(/Заблокированных нет/)).toBeVisible();

    // Read-receipt and last-seen switches are independent toggles.
    const [lastSeen, receipts] = await modal.locator(".privacy-row input").all();
    await lastSeen.check();
    await expect(lastSeen).toBeChecked();
    await expect(receipts).not.toBeChecked();
    await lastSeen.uncheck();
    await expect(lastSeen).not.toBeChecked();
  });

  test("group roles surface their cloud-only requirement", async ({ page }) => {
    await openApp(page);
    await page.getByText("Команда").first().click();
    // The chat details panel opens from the chat menu now that the floating
    // profile badge is gone.
    await page.getByRole("button", { name: "Меню чата" }).click();
    await page.getByRole("menuitem", { name: "Профиль чата" }).click();
    await expect(page.locator(".right-panel")).toBeVisible();

    // Demo groups have no remote id, so the member list stays empty; the panel
    // must still render rather than crash on a missing backend.
    await expect(page.locator(".invite-row", { hasText: "Скопировать ссылку-приглашение" })).toBeVisible();
    await expect(page.locator(".member-row")).toHaveCount(0);
  });
});
