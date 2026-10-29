import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBILITY,
  MESSAGE_POLICY,
  PROFILE_VISIBILITY,
  acceptsStrangers,
  describeVisibility,
  isSearchable,
  mayStartChat,
  parseVisibility,
} from "./visibility";

describe("options", () => {
  it("offers three levels of profile visibility", () => {
    expect(PROFILE_VISIBILITY.map((item) => item.id)).toEqual(["everyone", "known", "nobody"]);
  });

  it("offers two message policies", () => {
    expect(MESSAGE_POLICY.map((item) => item.id)).toEqual(["everyone", "known"]);
  });

  it("defaults to the most open settings, so nobody is surprised by a lock", () => {
    expect(DEFAULT_VISIBILITY).toEqual({ profile: "everyone", messages: "everyone" });
  });
});

describe("isSearchable", () => {
  it("is false only when nobody may see the profile", () => {
    expect(isSearchable("everyone")).toBe(true);
    expect(isSearchable("known")).toBe(true);
    expect(isSearchable("nobody")).toBe(false);
  });
});

describe("acceptsStrangers", () => {
  it("is true only for the open policy", () => {
    expect(acceptsStrangers("everyone")).toBe(true);
    expect(acceptsStrangers("known")).toBe(false);
  });
});

describe("mayStartChat", () => {
  it("always allows someone already known", () => {
    const closed = { profile: "nobody", messages: "known" } as const;
    expect(mayStartChat(closed, true)).toBe(true);
  });

  it("allows a stranger when both settings are open", () => {
    expect(mayStartChat({ profile: "everyone", messages: "everyone" }, false)).toBe(true);
  });

  it("refuses a stranger when messages are limited to known people", () => {
    expect(mayStartChat({ profile: "everyone", messages: "known" }, false)).toBe(false);
  });

  it("refuses a stranger when the profile is hidden, even if messages are open", () => {
    // Hiding from search while accepting strangers would be incoherent.
    expect(mayStartChat({ profile: "nobody", messages: "everyone" }, false)).toBe(false);
  });
});

describe("parseVisibility", () => {
  it("keeps valid values", () => {
    expect(parseVisibility({ profile: "known", messages: "known" })).toEqual({ profile: "known", messages: "known" });
  });

  it("falls back to defaults for anything unreadable", () => {
    expect(parseVisibility(null)).toEqual(DEFAULT_VISIBILITY);
    expect(parseVisibility({})).toEqual(DEFAULT_VISIBILITY);
    expect(parseVisibility({ profile: "wat", messages: 42 })).toEqual(DEFAULT_VISIBILITY);
  });

  it("keeps the valid half of a partly broken value", () => {
    expect(parseVisibility({ profile: "nobody", messages: "nope" })).toEqual({
      profile: "nobody",
      messages: DEFAULT_VISIBILITY.messages,
    });
  });
});

describe("describeVisibility", () => {
  it("says plainly when nobody can find you", () => {
    expect(describeVisibility({ profile: "nobody", messages: "known" })).toBe("Меня нельзя найти поиском");
  });

  it("says when anyone can write", () => {
    expect(describeVisibility({ profile: "everyone", messages: "everyone" })).toBe(
      "Профиль виден всем, писать может любой"
    );
  });

  it("says when only acquaintances can write", () => {
    expect(describeVisibility({ profile: "known", messages: "known" })).toBe(
      "Профиль виден знакомым, писать могут только знакомые"
    );
  });
});
