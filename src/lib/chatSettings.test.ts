import { describe, expect, it } from "vitest";
import {
  MUTE_FOREVER,
  MUTE_OPTIONS,
  attentionTotal,
  isArchived,
  isMuted,
  isMutedForever,
  muteLabel,
  muteUntil,
} from "./chatSettings";

const NOW = new Date("2026-03-01T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("MUTE_OPTIONS", () => {
  it("offers durations and a forever option", () => {
    expect(MUTE_OPTIONS.some((option) => option.minutes === null)).toBe(true);
    expect(MUTE_OPTIONS.filter((option) => option.minutes !== null).length).toBeGreaterThan(1);
  });
});

describe("muteUntil", () => {
  it("adds the chosen duration", () => {
    expect(muteUntil("1h", NOW)?.toISOString()).toBe(later(60).toISOString());
    expect(muteUntil("8h", NOW)?.toISOString()).toBe(later(8 * 60).toISOString());
  });

  it("returns a distant date for forever", () => {
    expect(muteUntil("forever", NOW)?.getTime()).toBe(MUTE_FOREVER.getTime());
  });

  it("returns null for an unknown option", () => {
    expect(muteUntil("nope" as never, NOW)).toBeNull();
  });
});

describe("isMuted", () => {
  it("is false without a mute", () => {
    expect(isMuted(null, NOW)).toBe(false);
    expect(isMuted(undefined, NOW)).toBe(false);
  });

  it("is true before the end", () => {
    expect(isMuted(later(30), NOW)).toBe(true);
  });

  it("expires on its own once the moment passes", () => {
    expect(isMuted(later(-1), NOW)).toBe(false);
  });

  it("accepts a number as well as a Date", () => {
    expect(isMuted(later(30).getTime(), NOW)).toBe(true);
  });

  it("treats forever as muted", () => {
    expect(isMuted(MUTE_FOREVER, NOW)).toBe(true);
    expect(isMuted(MUTE_FOREVER, new Date("2030-01-01T00:00:00Z"))).toBe(true);
  });
});

describe("isMutedForever", () => {
  it("recognises the forever value", () => {
    expect(isMutedForever(MUTE_FOREVER)).toBe(true);
  });

  it("does not treat a timed mute as forever", () => {
    expect(isMutedForever(later(60))).toBe(false);
    expect(isMutedForever(null)).toBe(false);
  });
});

describe("muteLabel", () => {
  it("says nothing when not muted", () => {
    expect(muteLabel(null, NOW)).toBeNull();
    expect(muteLabel(later(-5), NOW)).toBeNull();
  });

  it("shows minutes for a short mute", () => {
    expect(muteLabel(later(40), NOW)).toBe("Без звука 40 мин");
  });

  it("shows hours for a medium mute", () => {
    expect(muteLabel(later(5 * 60), NOW)).toBe("Без звука 5 ч");
  });

  it("shows days for a long mute", () => {
    expect(muteLabel(later(3 * 24 * 60), NOW)).toBe("Без звука 3 дн");
  });

  it("says plainly when there is no end", () => {
    expect(muteLabel(MUTE_FOREVER, NOW)).toBe("Без звука");
  });
});

describe("isArchived", () => {
  it("is false for nothing", () => {
    expect(isArchived(null)).toBe(false);
    expect(isArchived(undefined)).toBe(false);
    expect(isArchived(0)).toBe(false);
  });

  it("is true once archived", () => {
    expect(isArchived(NOW)).toBe(true);
    expect(isArchived(NOW.getTime())).toBe(true);
  });
});

describe("attentionTotal", () => {
  it("adds up unread in ordinary chats", () => {
    expect(attentionTotal([{ unread: 2 }, { unread: 3 }], NOW)).toBe(5);
  });

  it("leaves out muted chats", () => {
    expect(attentionTotal([{ unread: 2, mutedUntil: later(60) }, { unread: 3 }], NOW)).toBe(3);
  });

  it("counts a chat again once its mute expires", () => {
    expect(attentionTotal([{ unread: 2, mutedUntil: later(-60) }], NOW)).toBe(2);
  });

  it("leaves out archived chats", () => {
    expect(attentionTotal([{ unread: 2, archived: true }, { unread: 1 }], NOW)).toBe(1);
  });

  it("is zero for an empty list", () => {
    expect(attentionTotal([], NOW)).toBe(0);
  });

  it("ignores missing unread counts", () => {
    expect(attentionTotal([{}, { unread: 2 }], NOW)).toBe(2);
  });
});
