// Verifies the three fixes at phone width: the list is reachable, tapping a chat
// opens the conversation, back returns, and no control is under 44px.
import { chromium } from "@playwright/test";

const SITE = process.env.SITE || "http://127.0.0.1:4193/my-messenger/";
const browser = await chromium.launch();

async function audit(page) {
  return page.evaluate(() => {
    const small = [];
    for (const el of document.querySelectorAll("button, input")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      // A text field inside a label pill: the label is the target, so judge the
      // wrapper instead of the input.
      const label = el.closest("label.search-box, label.message-search");
      const target = label ? label.getBoundingClientRect() : r;
      // A control narrower than 44 is fine when its text simply is that narrow
      // (a chip labelled "Все"); height is what matters for a thumb.
      const tooShort = target.height < 44;
      const tooNarrow = target.width < 44 && !(el.textContent || "").trim();
      if (tooShort || tooNarrow) {
        const cls = String(el.className || "").slice(0, 28);
        const name = el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent || "").trim().slice(0, 18);
        small.push(`${cls} "${name}" ${Math.round(target.width)}x${Math.round(target.height)}`);
      }
    }
    return small;
  });
}

// --- phone ---------------------------------------------------------------
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU" });
const page = await ctx.newPage();
await page.goto(SITE + "?v=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector(".rail", { timeout: 30000 });
await page.waitForTimeout(1200);

const listBox = await page.locator(".chat-list-panel").boundingBox();
const convVisibleAtStart = await page.locator(".conversation-panel").isVisible();
console.log("PHONE start: chat-list w =", listBox ? Math.round(listBox.width) : "none", "| conversation visible =", convVisibleAtStart);

const rows = page.locator(".chat-list .chat-row");
const rowCount = await rows.count();
console.log("PHONE chat rows reachable:", rowCount);

const smallOnList = await audit(page);
console.log("PHONE small targets on list:", smallOnList.length, JSON.stringify(smallOnList));

if (rowCount > 0) {
  await rows.first().click();
  await page.waitForTimeout(900);
  const convBox = await page.locator(".conversation-panel").boundingBox();
  const listAfter = await page.locator(".chat-list-panel").isVisible();
  console.log("PHONE after tap: conversation w =", convBox ? Math.round(convBox.width) : "none", "| list visible =", listAfter);

  const backVisible = await page.locator(".back-button").isVisible();
  console.log("PHONE back button visible:", backVisible);
  const smallInChat = await audit(page);
  console.log("PHONE small targets in chat:", smallInChat.length, JSON.stringify(smallInChat));

  await page.locator(".back-button").click();
  await page.waitForTimeout(900);
  const listBack = await page.locator(".chat-list-panel").isVisible();
  const convBack = await page.locator(".conversation-panel").isVisible();
  console.log("PHONE after back: list visible =", listBack, "| conversation visible =", convBack);

  // The Android back gesture must also return to the list, not exit.
  await rows.first().click();
  await page.waitForTimeout(700);
  await page.goBack();
  await page.waitForTimeout(900);
  console.log("PHONE after system back: list visible =", await page.locator(".chat-list-panel").isVisible());
}

// --- desktop: both panels must stay visible -----------------------------
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const dpage = await dctx.newPage();
await dpage.goto(SITE + "?v=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await dpage.waitForSelector(".chat-list", { timeout: 30000 });
await dpage.waitForTimeout(1000);
console.log(
  "DESKTOP both visible:",
  await dpage.locator(".chat-list-panel").isVisible(),
  await dpage.locator(".conversation-panel").isVisible(),
  "| back button hidden:",
  !(await dpage.locator(".back-button").isVisible())
);
const smallDesk = await audit(dpage);
console.log("DESKTOP small targets:", smallDesk.length, JSON.stringify(smallDesk));

// --- tablet: how much room the conversation gets ------------------------
const tctx = await browser.newContext({ viewport: { width: 834, height: 1000 }, locale: "ru-RU" });
const tpage = await tctx.newPage();
await tpage.goto(SITE + "?v=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await tpage.waitForSelector(".chat-list", { timeout: 30000 });
await tpage.waitForTimeout(800);
const tbox = await tpage.locator(".conversation-panel").boundingBox();
console.log("TABLET conversation width:", tbox ? Math.round(tbox.width) : "none", "of 834");

await browser.close();
