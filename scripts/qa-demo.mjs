/**
 * Walks every feature the demo build can honestly show and measures what happens.
 *
 * The demo build has no cloud, so features that need one (reactions, attachments, voice and
 * video notes, polls in the cloud, calls) are checked for the thing they must do instead:
 * say plainly what is missing. A control that does nothing silently is the defect; one that
 * explains itself is working as designed.
 *
 * Run: node scripts/qa-demo.mjs [base-url]
 * Default base: http://127.0.0.1:5174/my-messenger/ (a preview of the demo build).
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://127.0.0.1:5174/my-messenger/";
const tag = () => `?qa=${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(44)} ${detail}`);
};

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

/** Opens a fresh page against the demo build and waits until the app has settled. */
async function open(viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: "ru-RU", permissions: ["microphone", "camera"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 90)));
  await page.goto(base + tag(), { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector(".chat-row", { timeout: 30000 });
  await page.waitForTimeout(1000);
  return { page, context, errors };
}

const notice = (page) => page.locator('[class*="toast"], [role="status"]').allTextContents();

// --- chats and messages -------------------------------------------------------------
{
  const { page, context, errors } = await open();
  const before = await page.locator(".chat-row").count();
  record("чат-лист отрисован", before > 0, `${before} чатов`);

  await page.locator(".chat-row").nth(1).click();
  await page.waitForTimeout(600);
  record("переключение чата", (await page.locator(".chat-row.selected").count()) === 1);

  const composer = page.locator('.composer input[aria-label="Текст сообщения"]');
  await composer.fill("проверка отправки");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  record("отправка сообщения", (await page.getByText("проверка отправки").count()) > 0);

  await page.locator(".message-line").last().hover();
  await page.locator(".message-menu-toggle").last().click();
  await page.waitForTimeout(400);
  const items = await page.locator(".message-actions button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.textContent.trim()));
  record("меню сообщения", items.length >= 10, `${items.length} пунктов`);

  // Reply: a quote must appear above the field.
  await page.locator(".message-actions button", { hasText: "Ответить" }).click();
  await page.waitForTimeout(500);
  record("ответ на сообщение", (await page.locator(".reply-banner").count()) > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Edit: the field comes back with the text, and sending replaces it.
  await composer.fill("черновик-А");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await page.locator(".message-line").last().hover();
  await page.locator(".message-menu-toggle").last().click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Редактировать сообщение"]').click();
  await page.waitForTimeout(500);
  const prefilled = await composer.inputValue();
  await composer.fill("черновик-Б");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  record(
    "правка сообщения",
    prefilled === "черновик-А" && (await page.getByText("черновик-Б").count()) > 0 && (await page.getByText("до правки").count()) === 0,
    `поле было «${prefilled}»`
  );

  // Forward and pin work locally, without the cloud.
  await page.locator(".message-line").last().hover();
  await page.locator(".message-menu-toggle").last().click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Переслать сообщение"]').click();
  await page.waitForTimeout(700);
  record("пересылка", (await notice(page)).some((t) => /переслан/i.test(t)));

  await page.locator(".message-line").last().hover().catch(() => {});
  await page.locator(".message-menu-toggle").last().click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Закрепить сообщение"]').first().click();
  await page.waitForTimeout(700);
  record("закрепление", (await notice(page)).some((t) => /закрепл/i.test(t)) || (await page.locator('[class*="pinned"]').count()) > 0);

  // Delete, then undo. The row is found by its own bubble: a forwarded copy quotes the text
  // behind a "Переслано" marker, and "the message is still on screen" is not what delete
  // means. The predicate is written inline because only its argument crosses into the page.
  const ownRows = () =>
    page.locator(".messages-area .message-line").evaluateAll((nodes) =>
      nodes.filter((node) => {
        const text = (node.querySelector(".bubble")?.textContent || "").replace(/\s+/g, " ");
        return text.includes("черновик-Б") && !text.includes("Переслано");
      }).length
    );
  const targetIndex = await page.locator(".messages-area .message-line").evaluateAll((nodes) =>
    nodes.findIndex((node) => {
      const text = (node.querySelector(".bubble")?.textContent || "").replace(/\s+/g, " ");
      return text.includes("черновик-Б") && !text.includes("Переслано");
    })
  );
  const messageRow = page.locator(".messages-area .message-line").nth(targetIndex);
  await messageRow.hover();
  await messageRow.locator(".message-menu-toggle").click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Удалить у всех"]').click();
  // The toast stays for ten seconds, so it is clicked first and the list is checked after:
  // waiting for the row to disappear first can outlive the offer.
  const undo = page.locator('button:has-text("Отменить")').first();
  const hasUndo = await undo
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const gone = (await ownRows()) === 0;
  if (hasUndo) await undo.click();
  await page.waitForTimeout(700);
  const back = (await ownRows()) > 0;
  record("удаление и отмена", gone && hasUndo && back, `исчезло ${gone}, есть отмена ${hasUndo}, вернулось ${back}`);
  // Reactions need the cloud, and must say so rather than do nothing.
  await page.locator(".message-line").last().hover();
  await page.locator(".message-menu-toggle").last().click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Реакция ❤️"]').click();
  await page.waitForTimeout(600);
  record("реакция объясняет облако", (await notice(page)).some((t) => /облачн/i.test(t)));

  record("ошибок на странице нет", errors.length === 0, errors.slice(0, 2).join("; "));
  await context.close();
}

// --- polls ---------------------------------------------------------------------------
{
  const { page, context } = await open();
  await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Опрос")').first().click();
  await page.waitForTimeout(600);
  const title = await page.locator('[class*="modal"] strong, [class*="modal"] h2').first().textContent();
  await page.getByPlaceholder("Что выбираем?").fill("Лучший мессенджер?");
  await page.getByPlaceholder("Вариант 1").fill("Nexus");
  await page.getByPlaceholder("Вариант 2").fill("Другой");
  await page.getByRole("button", { name: "Опубликовать опрос" }).click();
  await page.waitForTimeout(900);
  const text = await page.locator("body").innerText();
  const option = page.locator('[class*="poll"] button', { hasText: "Nexus" }).first();
  await option.click();
  await page.waitForTimeout(800);
  const after = await page.locator("body").innerText();
  record(
    "опрос: создание и голос",
    text.includes("Лучший мессенджер?") && /100%/.test(after),
    `окно «${(title || "").trim()}», после голоса ${(after.match(/\d+%/g) || []).slice(0, 2).join(" / ")}`
  );
  await context.close();
}

// --- voice note, with a fake microphone ----------------------------------------------
{
  const { page, context } = await open();
  await page.locator(".voice-button").click();
  await page.waitForTimeout(2000);
  const recording = await page.locator('[aria-label="Остановить запись"]').count();
  const timer = ((await page.locator(".voice-button").textContent()) || "").trim();
  if (recording) {
    await page.locator('[aria-label="Остановить запись"]').click();
    await page.waitForTimeout(1200);
  }
  record("голосовое: запись", recording > 0, `таймер ${timer}`);
  await context.close();
}

// --- video note ----------------------------------------------------------------------
{
  const { page, context } = await open();
  await page.getByLabel("Записать видеозаметку").click();
  await page.waitForTimeout(1200);
  const start = page.getByRole("button", { name: "Начать запись" });
  const hasStart = (await start.count()) > 0;
  if (hasStart) await start.click();
  await page.waitForTimeout(1800);
  const stop = page.locator('[aria-label="Остановить запись"], button:has-text("Остановить")').first();
  const hasStop = (await stop.count()) > 0;
  if (hasStop) await stop.click();
  await page.waitForTimeout(800);
  record("видеозаметка: запись", hasStart && hasStop);
  await context.close();
}

// --- search --------------------------------------------------------------------------
{
  const { page, context } = await open();
  const rows = await page.locator(".chat-row").count();
  await page.locator('input[placeholder*="Поиск чатов"]').fill("Макс");
  await page.waitForTimeout(600);
  const filtered = await page.locator(".chat-row").count();
  record("поиск по чатам", filtered < rows && filtered > 0, `${rows} → ${filtered}`);
  await page.locator('input[placeholder*="Поиск чатов"]').fill("");

  await page.getByRole("button", { name: "Поиск по переписке" }).click();
  await page.waitForTimeout(500);
  const field = page.getByPlaceholder("Найти сообщение в этом чате...");
  await field.fill("Привет");
  await page.waitForTimeout(700);
  const found = await page.locator(".message-line").count();
  await field.fill("слово-которого-нет");
  await page.waitForTimeout(700);
  const none = await page.locator(".message-line").count();
  const explained = (await page.locator("body").innerText()).includes("Сообщения не найдены");
  record("поиск по сообщениям", found > 0 && none === 0 && explained, `найдено ${found}, пусто объяснено: ${explained}`);
  await context.close();
}

// --- folders -------------------------------------------------------------------------
{
  const { page, context } = await open();
  await expectCount(page, ".chat-file-button", 0, "папок нет — кнопки нет");
  await page.getByLabel("Создать папку").click();
  await page.getByLabel("Название папки").fill("Работа");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const row = page.locator(".chat-row").first();
  await row.hover();
  await page.waitForTimeout(250);
  const button = await page.locator(".chat-file-button").first().boundingBox();
  await page.locator(".chat-file-button").first().click();
  await page.waitForTimeout(500);
  await page.locator(".folder-option", { hasText: "Работа" }).click();
  await page.waitForTimeout(400);
  await page.locator('.folder-picker button[aria-label="Закрыть"]').click();
  await page.waitForTimeout(300);
  await page.locator(".folder-chip > button").first().click();
  await page.waitForTimeout(500);
  const inside = await page.locator(".chat-row").count();
  record(
    "папки: создание и раскладка",
    inside === 1 && button && button.width >= 44 && button.height >= 44,
    `в папке ${inside} чат, кнопка ${Math.round(button?.width || 0)}×${Math.round(button?.height || 0)}`
  );
  await context.close();
}

async function expectCount(page, selector, expected, label) {
  const actual = await page.locator(selector).count();
  record("папки: кнопка появляется с папкой", actual === expected, label);
}

// --- settings that change something measurable -----------------------------------------
{
  const { page, context } = await open();
  await page.getByLabel("Настройки").click();
  await page.waitForTimeout(600);
  await page.locator(".settings-nav button", { hasText: "Оформление" }).click();
  await page.waitForTimeout(600);

  const theme = page.locator(".settings-body select").first();
  const accents = [];
  for (const value of ["yellow", "mint"]) {
    await theme.selectOption(value);
    await page.waitForTimeout(400);
    accents.push(await page.evaluate(() => {
      const el = document.querySelector(".chat-row.selected");
      return el ? getComputedStyle(el).borderColor : "";
    }));
  }
  record("тема меняет акцент", accents[0] !== accents[1], accents.join(" → "));

  const sizes = [];
  for (const label of ["Мелкий", "Крупный"]) {
    await page.locator(".settings-body button", { hasText: label }).first().click();
    await page.waitForTimeout(400);
    sizes.push(await page.locator(".chat-row-copy strong").first().evaluate((el) => getComputedStyle(el).fontSize));
  }
  record("размер текста меняется", sizes[0] !== sizes[1], sizes.join(" → "));

  let wallpaperDrawn = 0;
  for (const label of ["Точки", "Сетка", "Волны"]) {
    await page.locator(".settings-body button", { hasText: label }).first().click();
    await page.waitForTimeout(400);
    wallpaperDrawn += await page.locator(".wallpaper-layer").count();
  }
  record("обои рисуются", wallpaperDrawn >= 2, `${wallpaperDrawn} из 3 вариантов`);

  const language = page.locator(".settings-body select").last();
  await language.selectOption("en");
  await page.waitForTimeout(700);
  const english = /Settings|Appearance|Chats|Profile/i.test(await page.locator("body").innerText());
  record("язык переключается", english);
  await context.close();
}

// --- calendar: the passcode lock -------------------------------------------------------
{
  const { page, context } = await open();
  await page.getByLabel("Настройки").click();
  await page.waitForTimeout(600);
  await page.locator(".settings-nav button", { hasText: "Данные" }).click();
  await page.waitForTimeout(600);
  await page.locator('.settings-body input[placeholder*="од"], .settings-body input[aria-label*="код"]').first().fill("1234");
  await page.locator('.settings-body button', { hasText: /Включить/ }).last().click();
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1600);
  const hidden = (await page.locator(".chat-row").count()) === 0;
  const code = page.locator('input[type="password"], input[inputmode="numeric"], input[placeholder*="од"]').first();
  await code.fill("0000");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  const lockedStill = (await page.locator(".chat-row").count()) === 0;
  await code.fill("1234");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  const opened = (await page.locator(".chat-row").count()) > 0;
  record("код-пароль", hidden && lockedStill && opened, `скрыто ${hidden}, ложный код держит ${lockedStill}, верный пускает ${opened}`);
  await context.close();
}

// --- layout and reachable controls ----------------------------------------------------
{
  const widths = [320, 390, 768, 1440];
  const overflow = [];
  for (const width of widths) {
    const { page, context } = await open({ width, height: 800 });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (wide) overflow.push(width);
    await context.close();
  }
  record("нет горизонтальной прокрутки", overflow.length === 0, overflow.length ? "прокрутка на " + overflow.join(", ") : `${widths.length} ширин`);
}

{
  const { page, context } = await open({ width: 390, height: 844 });
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a, input, [role=\"button\"]")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 44 || rect.height < 44) out.push((el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24) || el.tagName);
    }
    return out;
  });
  record("цели нажатия ≥ 44 px", small.length === 0, small.length ? small.slice(0, 3).join(", ") : "все");

  const unnamed = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, input, select")) {
      const named =
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent || "").trim() ||
        el.getAttribute("placeholder") ||
        el.closest("label");
      if (!named) out.push(el.tagName + "." + String(el.className).slice(0, 22));
    }
    return out;
  });
  record("у всех элементов есть имя", unnamed.length === 0, unnamed.slice(0, 3).join(", "));
  await context.close();
}

// --- offline --------------------------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: "ru-RU" });
  const page = await context.newPage();
  await page.goto(base + tag(), { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector(".chat-row", { timeout: 30000 });
  await page.waitForTimeout(2500);
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration ? registration.active?.state || "none" : "none";
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const offlineChats = await page.locator(".chat-row").count();
  record("офлайн: приложение открывается", offlineChats > 0, `service worker ${worker}, чатов ${offlineChats}`);
  await context.close();
}

// --- settings button, chat deletion, scroll and read receipts ---------------------------
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 70)));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(base + tag(), { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector(".chat-row", { timeout: 30000 });
  await page.waitForTimeout(1200);

  // Settings must open on settings. It used to open on the profile, with the rest behind an
  // arrow that looked like it would close the window.
  await page.getByLabel("Настройки").click();
  await page.waitForTimeout(800);
  const sections = await page.locator(".settings-nav-item").count();
  record("настройки открываются списком", sections >= 4, `разделов ${sections}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Deleting the conversation, from the row itself.
  const rowsBefore = await page.locator(".chat-row").count();
  const deletes = await page.locator(".chat-delete-button").count();
  const firstName = await page.locator(".chat-delete-button").first().getAttribute("aria-label");
  await page.locator(".chat-delete-button").first().click();
  await page.waitForTimeout(1200);
  const rowsAfter = await page.locator(".chat-row").count();
  record("удаление чата из строки", deletes === rowsBefore && rowsAfter === rowsBefore - 1, `${firstName}: ${rowsBefore} → ${rowsAfter}`);

  // A long conversation opens on its newest message, not at the top.
  await page.locator(".chat-row").first().click();
  await page.waitForTimeout(900);
  const composer = page.locator('.composer input[aria-label="Текст сообщения"]');
  for (let i = 1; i <= 20; i += 1) {
    await composer.fill("прокрутка " + i);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(1200);
  const newestVisible = async () =>
    page.evaluate(() => {
      const area = document.querySelector(".messages-area");
      const rows = [...document.querySelectorAll(".messages-area .message-line")];
      const last = rows.at(-1);
      if (!area || !last) return false;
      const bottom = area.getBoundingClientRect().bottom;
      return last.getBoundingClientRect().bottom <= bottom + 40;
    });
  const beforeLeaving = await newestVisible();
  await page.getByLabel("Назад к чатам").click();
  await page.waitForTimeout(700);
  await page.locator(".chat-row").first().click();
  await page.waitForTimeout(1500);
  const afterReturn = await newestVisible();
  record("чат открывается на новых сообщениях", beforeLeaving && afterReturn, `при возврате ${afterReturn ? "видно" : "не видно"} последнее`);

  // Sitting outside a chat must not claim anything was read.
  await page.getByLabel("Назад к чатам").click();
  await page.waitForTimeout(600);
  const readLabels = await page.locator('[aria-label="Прочитано"]').count();
  record("вне чата ничего не прочитано", readLabels === 0, `меток «Прочитано» ${readLabels}`);
  record("ошибок на странице нет (правки)", errors.length === 0, errors.slice(0, 2).join(", "));
  await context.close();
}

// --- a camera that refuses ---------------------------------------------------------------
{
  // This browser is launched with a fake camera and a standing "allow", so a real refusal
  // cannot be produced here. The refusal is simulated instead: what is under test is that
  // the sheet names the reason and offers a retry, not how the browser was configured.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    const real = media.getUserMedia.bind(media);
    window.__nexusCameraBroken = true;
    media.getUserMedia = (constraints) => {
      if (!window.__nexusCameraBroken) return real(constraints);
      const failure = new Error("denied");
      failure.name = "NotAllowedError";
      return Promise.reject(failure);
    };
  });
  await page.goto(base + tag(), { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector(".chat-row", { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.locator(".chat-row").first().click();
  await page.waitForTimeout(700);
  await page.getByLabel("Записать видеозаметку").click();
  await page.locator(".note-error").waitFor({ timeout: 15000 });
  const wording = await page.evaluate(() => (document.querySelector(".note-error")?.textContent || "").replace(/\s+/g, " ").trim());
  const named = wording.includes("запрещена в браузере") && !wording.includes("Разреши её в настройках");
  const retry = await page.locator(".note-error button").count();
  record("камера: причина названа", named, wording.slice(0, 46));

  // Allowing it and pressing retry must open the camera without closing the sheet.
  await page.evaluate(() => { window.__nexusCameraBroken = false; });
  await page.locator(".note-error button").click();
  await page.waitForTimeout(2000);
  const recovered = await page.evaluate(() => {
    const video = document.querySelector("video");
    return { camera: video ? Boolean(video.srcObject) : false, cleared: !document.querySelector(".note-error") };
  });
  const canRecord = await page.getByLabel("Начать запись").isEnabled().catch(() => false);
  record("камера: повтор запускает её", retry > 0 && recovered.camera && recovered.cleared && canRecord, recovered.camera ? "камера пошла" : "камера не пошла");
  await context.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} из ${results.length} проверок пройдено`);
if (failed.length) {
  console.log("Провалено: " + failed.map((f) => f.name).join(", "));
  process.exit(1);
}
