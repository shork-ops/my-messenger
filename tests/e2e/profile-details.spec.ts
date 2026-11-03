import { expect, test } from "@playwright/test";

/**
 * Who sees my photo and «О себе», and what a contact's card shows.
 *
 * The rule itself is enforced by the database (migration 20261057), which the demo build has
 * none of; what a browser can check is that the choice is offered, explained, and that a
 * contact's «О себе» actually reaches their card.
 */

test.describe("photo and «О себе»", () => {
  test("the privacy dialog offers three answers and explains each", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.locator(".rail").getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: /^Приватность/ }).click();
    await page.getByRole("button", { name: /Приватность и блокировки/ }).click();
    const modal = page.locator(".privacy-modal");
    await expect(modal).toBeVisible();

    const select = modal.getByLabel("Кто видит фото и «О себе»");
    // Nothing is hidden until the user asks.
    await expect(select).toHaveValue("everyone");
    await expect(select.locator("option")).toHaveText(["Все пользователи", "Мои контакты", "Никто"]);
    await expect(modal.getByText("Фото и «О себе» видят все")).toBeVisible();

    // The app has no address book, so the hint says who counts as a contact.
    await select.selectOption("contacts");
    await expect(modal.getByText("Видят только те, кому вы писали в личных чатах")).toBeVisible();

    await select.selectOption("nobody");
    await expect(modal.getByText(/Вместо фото другие увидят букву/)).toBeVisible();
  });

  test("a contact's «О себе» is shown in their card", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.locator(".chat-list .chat-row").filter({ hasText: "Максим" }).first().click();
    await page.getByRole("button", { name: "Меню чата" }).click();
    await page.getByRole("menuitem", { name: "Профиль чата" }).click();
    await expect(page.locator(".right-panel .chat-info-about")).toContainText("Фотограф. Люблю горы");
  });
});
