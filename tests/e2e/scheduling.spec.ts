import { expect, test } from "@playwright/test";

/**
 * Sending later.
 *
 * The demo chats live in the browser, so a scheduled message is refused with an explanation.
 * That refusal is the thing worth testing here: the alternative - accepting the message and
 * losing it when the tab closes - is the failure this feature exists to avoid, and it would
 * look identical to success until the message never arrived.
 */

test.describe("scheduled sending", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-messenger/");
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("the option is offered only when there is something to send", async ({ page }) => {
    // An empty draft has nothing to schedule, so the item is present but disabled rather
    // than opening a panel that can only be cancelled.
    await page.getByRole("button", { name: "Прикрепить" }).click();
    const item = page.getByRole("menuitem", { name: /Отправить позже/ });
    await expect(item).toBeVisible();
    await expect(item).toBeDisabled();
  });

  test("choosing a moment shows the message and the time it will go", async ({ page }) => {
    await page.getByLabel("Текст сообщения").fill("завтра напомнить");
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await page.getByRole("menuitem", { name: /Отправить позже/ }).click();

    const dialog = page.getByRole("dialog", { name: "Отправить позже" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".schedule-preview")).toHaveText("завтра напомнить");

    // The choices are moments a person would say, not an empty date field.
    const choices = dialog.locator(".schedule-choice");
    expect(await choices.count()).toBeGreaterThanOrEqual(4);
    await expect(choices.first()).toContainText(/сегодня|завтра|\d/);
  });

  test("a browser-only chat says so instead of pretending to schedule", async ({ page }) => {
    await page.getByLabel("Текст сообщения").fill("завтра напомнить");
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await page.getByRole("menuitem", { name: /Отправить позже/ }).click();
    await page.getByRole("dialog", { name: "Отправить позже" }).locator(".schedule-choice").first().click();

    await expect(page.getByText("Отложенная отправка работает в облачных чатах")).toBeVisible();
    // The panel closes: a refusal that leaves the panel open looks like work in progress.
    await expect(page.getByRole("dialog", { name: "Отправить позже" })).toBeHidden();
  });

  test("the panel closes on Escape without scheduling anything", async ({ page }) => {
    await page.getByLabel("Текст сообщения").fill("черновик");
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await page.getByRole("menuitem", { name: /Отправить позже/ }).click();
    await expect(page.getByRole("dialog", { name: "Отправить позже" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Отправить позже" })).toBeHidden();
    // The draft survives: cancelling a decision is not discarding the message.
    await expect(page.getByLabel("Текст сообщения")).toHaveValue("черновик");
  });
});
