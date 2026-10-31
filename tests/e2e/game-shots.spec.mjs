/**
 * Reads the games screens back as text.
 *
 * Looking at a screenshot is not available here, and "the element is visible" is a weak claim
 * anyway: a board can be on screen and still be the wrong board. This asserts what is written on
 * the screen - every square's label, every card's label, the texts a player reads.
 */

import { test, expect } from "@playwright/test";

async function openCatalogue(page) {
  await page.goto("/");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /игр/i }).first().click();
  await expect(page.getByRole("dialog", { name: "Мини-игры" })).toBeVisible();
}

test("the catalogue lists the three games and nothing invented", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCatalogue(page);

  const names = await page.locator(".game-picker-card strong").allTextContents();
  expect(names).toEqual(["Шахматы", "Uno", "Балда"]);

  const text = await page.getByRole("dialog", { name: "Мини-игры" }).innerText();
  // The Dota card is gone, and the third mode says why it is disabled.
  expect(text).not.toContain("Dota");
  expect(text).toContain("С другом");
  expect(text).toContain("появится");
  await page.screenshot({ path: "qa-shots/games-catalogue.png" });
});

test("the chess board has sixty-four labelled squares", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCatalogue(page);
  await page.locator(".game-play-label").nth(0).click();

  const squares = page.locator(".chess-square");
  await expect(squares).toHaveCount(64);

  // The labels are the point: a player who cannot see the pieces must be able to read them.
  const labels = await squares.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(labels[0]).toBe("a8, чёрная ладья");
  expect(labels[60]).toBe("e1, белый король");
  expect(labels[28]).toBe("e5");

  await page.screenshot({ path: "qa-shots/games-chess.png" });

  // Selecting a pawn marks the squares it can reach.
  await squares.nth(52).click();
  await expect(page.locator(".chess-destination")).toHaveCount(2);
  const header = await page.locator(".game-modal-header h2").innerText();
  expect(header).toBe("Ход белых");
});

test("a move is made and the opponent answers", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCatalogue(page);
  await page.locator(".game-play-label").nth(0).click();

  const squares = page.locator(".chess-square");
  await squares.nth(52).click(); // e2
  await squares.nth(36).click(); // e4

  // The scoresheet pairs a move with the answer, so the player's move alone is one line with an
  // empty second half, and the bot's answer fills it in rather than adding a line.
  await expect(page.locator(".chess-moves li")).toHaveCount(1);
  await page.getByRole("button", { name: "Ход бота" }).click();
  await expect(page.locator(".chess-moves li")).toHaveCount(1);
  const line = await page.locator(".chess-moves li").first().innerText();
  expect(line).toMatch(/e4/);
  expect(line).not.toContain("…");
});

test("the balda board opens with the word in the middle row", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCatalogue(page);
  await page.locator(".game-play-label").nth(2).click();

  await expect(page.locator(".balda-board")).toBeVisible();
  await expect(page.locator(".balda-cell")).toHaveCount(25);

  const filled = await page.locator(".balda-filled").allTextContents();
  expect(filled.join("")).toBe("БАЛДА");

  const text = await page.getByRole("dialog").innerText();
  expect(text).toContain("Счёт: 0 : 0");
  expect(text).toContain("Слов в словаре");
  await page.screenshot({ path: "qa-shots/games-balda.png" });
});

test("the card table deals a real hand", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCatalogue(page);
  await page.locator(".game-play-label").nth(1).click();

  await expect(page.locator(".uno-table")).toBeVisible();
  const hand = page.locator(".uno-hand .uno-card");
  await expect(hand).toHaveCount(7);

  // Every card says what it is. A coloured card names its colour; a wild card has none, and it
  // says which card it is instead - colour is never the only information either way.
  const labels = await hand.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  for (const label of labels) {
    expect(label).toMatch(/красный|синий|жёлтый|зелёный|дикая карта/);
  }
  await page.screenshot({ path: "qa-shots/games-cards.png" });
});

test("a saved game is offered again after closing", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCatalogue(page);
  await page.locator(".game-play-label").nth(2).click();
  await expect(page.locator(".balda-board")).toBeVisible();

  // Close the screen and reload: the game must still be there to continue.
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /игр/i }).first().click();

  const text = await page.getByRole("dialog", { name: "Мини-игры" }).innerText();
  expect(text).toContain("Продолжить");
  expect(text).toContain("Балда");
});

test("the boards work on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalogue(page);
  await page.locator(".game-play-label").nth(0).click();

  await expect(page.locator(".chess-square")).toHaveCount(64);
  // The board must fit: an overflowing board is unusable by touch.
  const box = await page.locator(".chess-board").boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "qa-shots/games-chess-phone.png" });
});
