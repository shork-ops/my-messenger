import { expect, test } from "@playwright/test";

test("offline hint does not erase a draft or pretend it was delivered", async ({ page, context }) => {
  await page.goto("/my-messenger/");
  const field = page.getByLabel("Текст сообщения");
  await field.fill("Черновик при потере сети");
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText:"Нет сети" })).toBeVisible();
  await expect(field).toHaveValue("Черновик при потере сети");
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText:"Нет сети" })).toHaveCount(0);
  await expect(field).toHaveValue("Черновик при потере сети");
});

test("overlong text stays in the composer with an actionable explanation", async ({ page }) => {
  await page.goto("/my-messenger/");
  const field = page.getByLabel("Текст сообщения");
  const draft = "а".repeat(10001);
  await field.fill(draft);
  await page.getByLabel("Отправить сообщение", { exact: true }).click();
  await expect(page.getByText(/Сообщение длиннее 10 000/)).toBeVisible();
  await expect(field).toHaveValue(draft);
});
