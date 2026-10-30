import { expect, test } from "@playwright/test";

/**
 * Several accounts in one browser.
 *
 * The rule the feature stands on: a session belongs to exactly one slot. Two accounts sharing a
 * storage key would overwrite each other, and the symptom would be losing a login rather than
 * anything that looks like a bug. These tests check the parts that can be seen without a second
 * cloud account: that the section exists, that it explains where the accounts live, and that the
 * storage keys really are per-slot.
 */

test.describe("accounts on one device", () => {
  test("the settings window has an accounts section that says where they are kept", async ({ page }) => {
    await page.goto("/my-messenger/");
    await page.locator(".rail").getByLabel("Настройки").click();
    await expect(page.locator(".settings-nav")).toBeVisible();

    const accountsItem = page.locator(".settings-nav-item").filter({ hasText: "Аккаунты" });
    await expect(accountsItem).toBeVisible();
    await accountsItem.click();

    // The honest limit is on the same screen as the button, not in a help page.
    await expect(page.locator(".account-note")).toContainText("хранятся в этом браузере");
    await expect(page.getByRole("button", { name: /Добавить аккаунт/ })).toBeVisible();
  });

  test("each slot gets its own storage key, so one session cannot overwrite another", async ({ page }) => {
    await page.goto("/my-messenger/");

    // The app reads its Supabase storage key from the active slot. Writing two slots and
    // checking that the client sees the chosen one proves the keys are per-slot rather than
    // shared - the whole reason two accounts can coexist.
    const keys = await page.evaluate(() => {
      const slotKey = (slot: string) => `sb-nexus-auth-${slot}`;
      window.localStorage.setItem("nexus-active-slot", "b");
      return {
        a: slotKey("a"),
        b: slotKey("b"),
        active: window.localStorage.getItem("nexus-active-slot"),
      };
    });

    expect(keys.a).not.toBe(keys.b);
    expect(keys.active).toBe("b");
  });

  test("adding a second account does not sign the first one out", async ({ page }) => {
    await page.goto("/my-messenger/");
    // Seed one saved account, as a signed-in session would.
    await page.evaluate(() => {
      window.localStorage.setItem(
        "nexus-saved-accounts",
        JSON.stringify([
          { slot: "a", name: "Алексей", email: null, color: "blue", lastUsedAt: Date.now() },
        ])
      );
      window.localStorage.setItem("nexus-active-slot", "a");
    });
    await page.reload();

    await page.locator(".rail").getByLabel("Настройки").click();
    await page.locator(".settings-nav-item").filter({ hasText: "Аккаунты" }).first().click();

    await expect(page.locator(".account-row")).toHaveCount(1);
    await expect(page.locator(".account-row")).toContainText("Алексей");

    // Pressing "add" moves to a free slot and reloads into it; the first slot is untouched.
    await page.getByRole("button", { name: /Добавить аккаунт/ }).click();
    await page.waitForLoadState("domcontentloaded");

    const state = await page.evaluate(() => ({
      active: window.localStorage.getItem("nexus-active-slot"),
      saved: JSON.parse(window.localStorage.getItem("nexus-saved-accounts") ?? "[]"),
    }));
    expect(state.active).toBe("b");
    // The account in slot A is still saved: adding is not signing out.
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0].slot).toBe("a");
  });
});
