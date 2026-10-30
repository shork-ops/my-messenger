import { expect, test } from "@playwright/test";

/**
 * A photo that may be opened once.
 *
 * What is checked here is the promise the interface makes: the picture is not in the document
 * before it is opened, it is shown with a countdown, and after the countdown it is gone and
 * cannot be brought back.
 *
 * What is deliberately not checked, because the browser cannot provide it, is a screenshot
 * alarm. The interface says so instead of pretending.
 */

test.describe("a photo that may be opened once", () => {
  test("is not in the page before it is opened", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.getByText("Фото на один раз").first().click();

    await expect(page.locator(".view-once-card.is-closed")).toBeVisible();
    // The bytes must not be painted: a picture that is already in the document is one that can
    // be looked at with the developer console, which is the promise being kept.
    await expect(page.locator(".view-once-card img.attachment-image")).toHaveCount(0);
    await expect(page.locator(".view-once-warning")).toContainText("10");
  });

  test("opens with a countdown, then is gone", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.getByText("Фото на один раз").first().click();

    await page.locator(".view-once-open").click();
    await expect(page.locator(".view-once-card img.attachment-image")).toHaveCount(1);
    await expect(page.locator(".view-once-countdown")).toContainText("Осталось");

    // The seed allows ten seconds; the test waits for the real countdown rather than mocking
    // it, because the timer is the feature.
    await expect(page.locator(".view-once-card.is-spent")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".view-once-card img.attachment-image")).toHaveCount(0);
    await expect(page.locator(".view-once-spent")).toContainText("больше нельзя");
  });

  test("stays gone after going to another chat and back", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.getByText("Фото на один раз").first().click();
    await page.locator(".view-once-open").click();
    await expect(page.locator(".view-once-card.is-spent")).toBeVisible({ timeout: 20_000 });

    await page.getByText("Максим").first().click();
    await page.getByText("Фото на один раз").first().click();

    // Reopening the conversation must not restore it. This is the whole point of the feature.
    await expect(page.locator(".view-once-spent")).toBeVisible();
    await expect(page.locator(".view-once-card img.attachment-image")).toHaveCount(0);
    await expect(page.locator(".view-once-open")).toHaveCount(0);
  });

  test("the composer offers it in the attachment menu", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.getByText("Максим").first().click();
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await expect(page.getByRole("menuitem", { name: "Посмотреть один раз" })).toBeVisible();
  });
});
