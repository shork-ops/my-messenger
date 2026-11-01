/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { capsWords, coolDownEnabled, isHeated, setCoolDownEnabled, shouldCoolDown } from "./coolDown";
import { coolText, formatDegrees, heatTitle, NORMAL_TEMPERATURE, scalePosition, temperature } from "./coolText";

const FAVOURITES = -1;
const chat = { id: 7 };

beforeEach(() => window.localStorage.clear());

describe("isHeated: more than three words in capitals", () => {
  it("lets three through and stops the fourth", () => {
    expect(isHeated("ТЫ ОПЯТЬ ОПОЗДАЛ")).toBe(false);
    expect(isHeated("ТЫ ОПЯТЬ НЕ ПРИШЁЛ")).toBe(true);
  });

  it("does not count single letters, which start sentences without shouting", () => {
    expect(capsWords("Я И Я И Я В")).toBe(0);
    expect(isHeated("I AM SO TIRED")).toBe(false);
  });

  it("ignores abbreviations in a calm sentence", () => {
    expect(isHeated("Была в США, потом в МФЦ, там всё ОК")).toBe(false);
  });

  it("does not judge code, links or mentions", () => {
    expect(capsWords("`SELECT ID FROM USERS WHERE OK` https://EXAMPLE.COM/API/V1/LIST @IVAN_PETROV_BIG_BOSS")).toBe(0);
  });

  it("ignores scripts without case and mixed-case words", () => {
    expect(isHeated("你好 你好 你好 你好 你好")).toBe(false);
    expect(isHeated("МакДональдс ЮНЕСКО iPhone ТВ")).toBe(false);
  });
});

describe("shouldCoolDown", () => {
  const loud = "ПОЧЕМУ ТЫ МНЕ НЕ ОТВЕТИЛ";

  it("asks in a conversation", () => {
    expect(shouldCoolDown(loud, chat, FAVOURITES)).toBe(true);
    expect(shouldCoolDown("почему ты мне не ответил", chat, FAVOURITES)).toBe(false);
  });

  it("does not ask in a channel or in Favourites", () => {
    expect(shouldCoolDown(loud, { id: 3, channel: true }, FAVOURITES)).toBe(false);
    expect(shouldCoolDown(loud, { id: FAVOURITES }, FAVOURITES)).toBe(false);
  });

  it("is on by default and remembers being switched off", () => {
    expect(coolDownEnabled()).toBe(true);
    setCoolDownEnabled(false);
    expect(coolDownEnabled()).toBe(false);
    expect(shouldCoolDown(loud, chat, FAVOURITES)).toBe(false);
    setCoolDownEnabled(true);
    expect(shouldCoolDown(loud, chat, FAVOURITES)).toBe(true);
  });
});

describe("coolText", () => {
  it("lowers the shouting and gives sentences their capital back", () => {
    expect(coolText("ТЫ ОПЯТЬ НЕ ПРИШЁЛ!!! Я ЖДАЛА ЧАС")).toBe("Ты опять не пришёл! Я ждала час");
    expect(coolText("НАМ НУЖЕН ОТЧЁТ\nСРОЧНО К ВЕЧЕРУ")).toBe("Нам нужен отчёт\nСрочно к вечеру");
  });

  it("leaves calm words and the person's own capitals alone", () => {
    expect(coolText("Привет, Маша! КАК ЖЕ МЕНЯ ЭТО БЕСИТ")).toBe("Привет, Маша! Как же меня это бесит");
    expect(coolText("Это ВАЖНО, НЕ ЗАБУДЬ ПРО ВСТРЕЧУ")).toBe("Это важно, не забудь про встречу");
  });

  it("keeps a short abbreviation that stands alone, and English «I»", () => {
    expect(coolText("СРОЧНО ПРИНЕСИ ДОКУМЕНТЫ в МФЦ")).toBe("Срочно принеси документы в МФЦ");
    expect(coolText("I KNOW WHAT YOU DID")).toBe("I know what you did");
  });

  it("collapses marks, stretched letters and angry faces", () => {
    expect(coolText("ДА ЧТО ЖЕ ЭТО ТАКОЕ?!?!")).toBe("Да что же это такое?!");
    expect(coolText("ну ВСЁ, Я УХОЖУ ОТСЮДА!!!111")).toBe("ну всё, я ухожу отсюда!");
    expect(coolText("НЕЕЕЕТ ТОЛЬКО НЕ ЭТО 😡🤬")).toBe("Нет только не это 😕😕");
    expect(coolText("ну дааааа, ОЧЕНЬ СМЕШНО ВСЁ ЭТО 🖕🏻")).toBe("ну да, очень смешно всё это");
  });

  it("never touches code, links or mentions", () => {
    expect(coolText("@IVAN ГДЕ ТВОЙ ОТЧЁТ ПО https://EXAMPLE.COM/REPORT `NULL`")).toBe(
      "@IVAN где твой отчёт по https://EXAMPLE.COM/REPORT `NULL`"
    );
  });
});

describe("temperature", () => {
  it("is normal for a calm message and high for a shouted one", () => {
    expect(temperature("привет, как дела?")).toBe(NORMAL_TEMPERATURE);
    expect(temperature("ТЫ ОПЯТЬ НЕ ПРИШЁЛ!!! Я ЖДАЛА ЧАС")).toBeGreaterThan(80);
    expect(temperature("ТЫ ОПЯТЬ НЕ ПРИШЁЛ!!!!!!!!!!!!!! 😡😡😡😡😡😡 нееееет")).toBeLessThanOrEqual(99.9);
  });

  it("drops after cooling", () => {
    const loud = "ПОЧЕМУ Я ДОЛЖНА ВСЁ ДЕЛАТЬ САМА???";
    expect(temperature(coolText(loud))).toBeLessThan(40);
  });

  it("is written the way a thermometer is read", () => {
    expect(formatDegrees(36.6)).toBe("36,6°");
    expect(formatDegrees(87.4)).toBe("87°");
    expect(scalePosition(NORMAL_TEMPERATURE)).toBe(0);
    expect(scalePosition(200)).toBe(1);
    expect(heatTitle(90).title).toBe("Сообщение раскалено");
    expect(heatTitle(70).title).toBe("Кажется, тут кипит");
    expect(heatTitle(50).title).toBe("Слишком громко?");
  });
});
