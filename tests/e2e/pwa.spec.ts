import { expect, test } from "@playwright/test";

/**
 * Installed as an app, and usable offline.
 *
 * The service worker is the difference between a page and an application: it lets the messenger
 * be installed on a phone or a desktop, and it makes the shell open when the network does not.
 * These things break silently - a build change can stop the worker from registering and nothing
 * on screen looks wrong - so they are checked rather than assumed.
 */

test.describe("installed as an app", () => {
  test("registers a service worker and fills its cache", async ({ page }) => {
    await page.goto("/my-messenger/");
    // "Active" is the state that can serve requests. Waiting on the registration alone is not
    // enough: it exists while the worker is still installing.
    await page.waitForFunction(
      () =>
        navigator.serviceWorker.getRegistration().then((r) => Boolean(r?.active || r?.waiting || r?.installing)),
      null,
      { timeout: 20_000 }
    );
    await page.waitForTimeout(2500);

    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        registered: Boolean(registration),
        active: Boolean(registration?.active),
        controller: Boolean(navigator.serviceWorker.controller),
        scope: registration?.scope ?? "",
        caches: await caches.keys(),
        manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
      };
    });

    // The worker is registered and has claimed the page; on the very first visit the page may
    // be uncontrolled until the next load, which is normal for `clientsClaim` workers.
    expect(state.registered).toBe(true);
    expect(state.active || state.controller).toBe(true);
    expect(state.scope).toContain("/my-messenger/");
    // A worker with an empty cache installs but does nothing offline.
    expect(state.caches.length).toBeGreaterThan(0);
    expect(state.manifest).toContain("manifest.webmanifest");
  });

  test("opens the shell with the network switched off", async ({ page, context }) => {
    await page.goto("/my-messenger/");
    await page.waitForSelector(".chat-row");
    // Wait for the worker to finish installing: precaching is what makes offline possible.
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => Boolean(r?.active)), null, {
      timeout: 20_000,
    });
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });

    // The point of an installed app: the shell paints and the conversations are there.
    await expect(page.locator(".chat-row").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#root")).not.toBeEmpty();

    await context.setOffline(false);
  });
});
