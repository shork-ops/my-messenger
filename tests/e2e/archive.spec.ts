import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

/**
 * The archive of everything.
 *
 * A backup is only worth having if it is complete and readable, so this checks the file that
 * actually arrives: that it downloads, that it names its format, that every conversation is in
 * it, and that it says plainly what it does not contain.
 */

test("the whole account downloads as one readable file", async ({ page }) => {
  await page.goto("/my-messenger/");

  // The rail button carries an accessible name; the settings navigation is a list of items.
  await page.locator(".rail").getByLabel("Настройки").click();
  await expect(page.locator(".settings-nav")).toBeVisible();

  // Privacy is a section of the settings window; the archive lives inside it, next to the
  // account deletion - the moment a person needs to know what the account held.
  await page.locator(".settings-nav-item").filter({ hasText: /Приватность/ }).first().click();
  const openPrivacy = page.getByRole("button", { name: /Приватность и блокировки/ });
  await expect(openPrivacy).toBeVisible();
  await openPrivacy.click();

  const archiveButton = page.getByRole("button", { name: /Скачать архив/i });
  await expect(archiveButton).toBeVisible();
  await expect(page.getByText(/Вложения в архив не входят/)).toBeVisible();

  const download = await Promise.all([page.waitForEvent("download"), archiveButton.click()]).then(
    ([event]) => event
  );

  expect(download.suggestedFilename()).toMatch(/^Nexus \d{4}-\d{2}-\d{2}\.json$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const text = await readFile(path as string, "utf8");
  const data = JSON.parse(text);

  expect(data.format).toBe("nexus-archive");
  expect(data.version).toBe(1);
  expect(data.profile.name).toBeTruthy();
  // The demo seed has chats with messages; the archive must hold them, not an empty shell.
  expect(data.chats.length).toBeGreaterThan(0);
  expect(data.total.messages).toBeGreaterThan(0);
  expect(Array.isArray(data.chats[0].messages)).toBe(true);

  // Formatted rather than minified: something a person may open should look readable.
  expect(text.split("\n").length).toBeGreaterThan(20);

  // And the file explains its own limit instead of leaving empty attachments unexplained.
  expect(String(data.note)).toContain("не входят");
});
