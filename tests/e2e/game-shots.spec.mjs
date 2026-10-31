/**
 * The games screens, read back as text.
 *
 * Looking at a screenshot is not available here, and "the element is visible" is a weak claim
 * anyway: a board can be on screen and still be the wrong board. This asserts what is written on
 * the screen - every square's label, every card's label, the sentences a player reads.
 *
 * The chess cases deliberately play real moves through the real UI, because the failure worth
 * catching is not "the board is missing" but "the board accepted a move the rules refuse".
 */

import { test, expect } from "@playwright/test";

/** The index of a square in the DOM order the board draws: row 0 is the eighth rank. */
function index(name) {
  return "abcdefgh".indexOf(name[0]) + (8 - Number(name[1])) * 8;
}

/** Opens the games catalogue from wherever the app lands. */
async function openCatalogue(page) {
  await page.goto("/");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Игр/i }).first().click();
  await expect(page.getByRole("dialog", { name: "Мини-игры" })).toBeVisible();
}

/** Starts the first (chess) game from the catalogue. */
async function startChess(page) {
  await openCatalogue(page);
  await page.locator(".game-play-label").nth(0).click();
  await expect(page.locator(".chess-square")).toHaveCount(64);
}

/** Plays a move by coordinate through the rendered board. */
async function play(page, from, to) {
  const squares = page.locator(".chess-square");
  await squares.nth(index(from)).click();
  await squares.nth(index(to)).click();
}

test("the catalogue lists the three games and nothing invented", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCatalogue(page);

  const names = await page.locator(".game-picker-card strong").allTextContents();
  expect(names).toEqual(["Шахматы", "Uno", "Балда"]);

  const text = await page.getByRole("dialog", { name: "Мини-игры" }).innerText();
  expect(text).not.toContain("Dota");
  // The hint now points at the route that actually exists: a shared game is opened from an
  // invitation in a chat, because that is where both players and the game id come from.
  expect(text).toContain("приглашение в чате");
  // The rules are readable before a game starts, limitations included.
  expect(text).toContain("Правила шахмат в этой игре");
});

test("the chess board has sixty-four labelled squares", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startChess(page);

  const labels = await page
    .locator(".chess-square")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  // A label is a sentence about the square, not a coordinate: the piece and its colour are the
  // part a player who cannot see the board needs.
  expect(labels[0]).toBe("a8, чёрная ладья");
  expect(labels[60]).toBe("e1, белый король");
  expect(labels[28]).toBe("e5, пусто");
});

test("selecting a piece marks the squares it may go to", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startChess(page);

  const squares = page.locator(".chess-square");
  await squares.nth(index("e2")).click();
  // A pawn on its home square reaches two squares, both marked.
  await expect(page.locator(".chess-destination")).toHaveCount(2);
  await expect(page.locator(".chess-dot")).toHaveCount(2);
  // The label says so too, for a player who cannot see the dots.
  expect(await squares.nth(index("e4")).getAttribute("aria-label")).toContain("можно пойти");
});

test("a move is made and the bot answers on its own", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startChess(page);

  // White plays e4 through the UI; black is the bot and must answer without being asked.
  await play(page, "e2", "e4");

  const first = page.locator(".chess-moves li").first();
  await expect(first).toContainText("e4");
  // The reply fills the second half of the same line: a scoresheet pairs moves, it does not add a
  // line for a reply to move one.
  await expect
    .poll(async () => (await first.innerText()).trim().split(/\s+/).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3);
});

test("the player cannot move the opponent's pieces", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startChess(page);

  // a7 is a black pawn with real moves; in a bot game it is not the player's to move.
  const a7 = page.locator(".chess-square").nth(index("a7"));
  await a7.click();
  expect(await a7.getAttribute("aria-pressed")).toBe("false");
  expect(await a7.getAttribute("tabindex")).toBe("-1");
});

test("a game in progress survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startChess(page);

  await play(page, "e2", "e4");
  await expect(page.locator(".chess-moves li")).toHaveCount(1);

  // Reload while the screen is open: the game must come back, with its moves.
  await page.reload();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Игр/i }).first().click();
  const catalogue = page.getByRole("dialog", { name: "Мини-игры" });
  await expect(catalogue).toContainText("Продолжить");

  await page.getByRole("button", { name: "Продолжить" }).first().click();
  await expect(page.locator(".chess-square")).toHaveCount(64);
  // The saved scoresheet is what was on it, not a fresh one.
  await expect(page.locator(".chess-moves li").first()).toContainText("e4");
});

test("the board fits a phone and the chat stays usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startChess(page);

  const board = await page.locator(".chess-board").boundingBox();
  expect(board.width).toBeLessThanOrEqual(390);
  // Every square must be big enough to hit with a finger: anything under 32 pixels is a miss
  // waiting to happen.
  expect(board.width / 8).toBeGreaterThan(32);

  // Nothing sticks out sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Closing the game brings the chat back: the screen is a dialog, not a takeover.
  await page.keyboard.press("Escape");
  await expect(page.locator(".chess-board")).toHaveCount(0);
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
  // The dictionary is a separate lazily-loaded chunk, so the board being visible above already
  // proves the chunk downloaded. This checks the count it reports is the generated one, not the
  // rules-screen placeholder, which would mean the load silently fell back.
  expect(text).toMatch(/Слов в словаре: \d{5} \(версия 2\)/);
});

test("the card table deals a real hand", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCatalogue(page);
  await page.locator(".game-play-label").nth(1).click();

  await expect(page.locator(".uno-table")).toBeVisible();
  const hand = page.locator(".uno-hand .uno-card");
  await expect(hand).toHaveCount(7);

  const labels = await hand.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  for (const label of labels) {
    expect(label).toMatch(/красный|синий|жёлтый|зелёный|дикая карта/);
  }
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
  await page.getByRole("button", { name: /Игр/i }).first().click();

  const text = await page.getByRole("dialog", { name: "Мини-игры" }).innerText();
  expect(text).toContain("Продолжить");
  expect(text).toContain("Балда");
});
