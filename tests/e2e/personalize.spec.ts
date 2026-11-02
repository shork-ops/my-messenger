import { expect, test } from "@playwright/test";

/**
 * Personal touches: the notification tone and one's own photo as the chat wallpaper. Both are
 * settings of this browser, so they are checked to survive a reload.
 */

// A 4×3 PNG, enough for the browser to decode and redraw.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOQqzgBRww4OQA4KhBpUsYmbgAAAABJRU5ErkJggg==",
  "base64"
);

async function openSettings(page: import("@playwright/test").Page, section: RegExp) {
  await page.locator(".rail").getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.locator(".settings-modal").first()).toBeVisible();
  await page.getByRole("button", { name: section }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/my-messenger/");
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("the notification tone is chosen by ear and kept", async ({ page }) => {
  await openSettings(page, /^Уведомления/);
  const tones = page.getByRole("group", { name: "Мелодия уведомлений" });
  await expect(tones.getByRole("button")).toHaveCount(5);
  await expect(tones.getByRole("button", { name: "Перезвон" })).toHaveAttribute("aria-pressed", "true");
  await tones.getByRole("button", { name: "Колокольчик" }).click();
  await expect(tones.getByRole("button", { name: "Колокольчик" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await openSettings(page, /^Уведомления/);
  await expect(page.getByRole("group", { name: "Мелодия уведомлений" }).getByRole("button", { name: "Колокольчик" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("one's own photo becomes the chat wallpaper, stays under the header, and can be removed", async ({ page }) => {
  await openSettings(page, /^Оформление/);
  await page.getByLabel("Выбрать фото для обоев").setInputFiles({ name: "sea.png", mimeType: "image/png", buffer: PNG });
  const photo = page.getByRole("group", { name: "Обои чата" }).getByRole("button", { name: "Своё фото" });
  await expect(photo).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Убрать фото" })).toBeVisible();
  await page.keyboard.press("Escape");

  const panel = page.locator(".conversation-panel.has-photo");
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveCSS("background-image", /url\("data:image\/jpeg/);
  // The photo is the panel's own background, so the chat header stays on top of it.
  await expect(panel.locator(".conversation-header")).toBeVisible();
  const header = await panel.locator(".conversation-header").boundingBox();
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest(".conversation-header") !== null,
    [header!.x + header!.width / 2, header!.y + header!.height / 2]
  );
  expect(topmost).toBe(true);

  await page.reload();
  await expect(page.locator(".conversation-panel.has-photo")).toHaveCount(1);

  await openSettings(page, /^Оформление/);
  await page.getByRole("button", { name: "Убрать фото" }).click();
  await expect(photo).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator(".conversation-panel.has-photo")).toHaveCount(0);
});
