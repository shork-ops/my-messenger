import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_STORAGE_KEY,
  languageLabel,
  parseLanguage,
  translate,
} from "./i18n";

const ru = {
  "settings.title": "Настройки",
  "settings.data.clear": "Очистить",
};

describe("LANGUAGES", () => {
  it("offers Russian and English", () => {
    expect(LANGUAGES.map((item) => item.id)).toEqual(["ru", "en"]);
  });

  it("labels both in their own language", () => {
    expect(languageLabel("ru")).toBe("Русский");
    expect(languageLabel("en")).toBe("English");
  });
});

describe("parseLanguage", () => {
  it("accepts the two known languages", () => {
    expect(parseLanguage("ru")).toBe("ru");
    expect(parseLanguage("en")).toBe("en");
  });

  it("falls back to Russian for anything else", () => {
    expect(parseLanguage(null)).toBe(DEFAULT_LANGUAGE);
    expect(parseLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
    expect(parseLanguage("")).toBe(DEFAULT_LANGUAGE);
    expect(parseLanguage("de")).toBe(DEFAULT_LANGUAGE);
  });
});

describe("translate", () => {
  it("returns English when English is chosen", () => {
    expect(translate("en", "settings.title", ru)).toBe("Settings");
  });

  it("returns the Russian source when Russian is chosen", () => {
    expect(translate("ru", "settings.title", ru)).toBe("Настройки");
  });

  it("falls back to Russian when the English string is missing, never to the key", () => {
    // A user reading Russian is confused; a user reading `settings.foo` is looking
    // at a bug. The key below is deliberately absent from the English dictionary.
    expect(translate("en", "settings.about", { "settings.about": "О себе" })).toBe("О себе");
  });

  it("returns the key when nothing is known, so the gap is visible", () => {
    expect(translate("en", "settings.data.clear")).toBe("Clear");
    expect(translate("en", "nope.not.here")).toBe("nope.not.here");
  });

  it("does not treat an empty translation as present", () => {
    expect(translate("en", "settings.title", { "settings.title": "" })).toBe("Settings");
  });
});

describe("LANGUAGE_STORAGE_KEY", () => {
  it("is a nexus key, so clear-cache owns it", () => {
    expect(LANGUAGE_STORAGE_KEY).toBe("nexus-language");
  });
});
