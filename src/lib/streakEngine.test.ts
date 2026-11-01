/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import type { Chat } from "../types";
import {
  celebration,
  dayWord,
  demoStreakRows,
  nextStreakLevel,
  readStreak,
  streakBadge,
  streakLabel,
  streakLevel,
  streakShown,
  streakViews,
  type StreakRow,
} from "./streakEngine";

const row = (patch: Partial<StreakRow>): StreakRow => ({
  chat_id: "c",
  last_full: "2026-11-01",
  run_days: 5,
  record_days: 5,
  today: "2026-11-01",
  today_mine: true,
  today_theirs: true,
  ...patch,
});

describe("readStreak", () => {
  it("counts today once both wrote", () => {
    const streak = readStreak(row({}));
    expect(streak).toMatchObject({ days: 5, alive: true, todayDone: true, lost: 0 });
  });

  it("keeps burning through today until midnight", () => {
    const streak = readStreak(row({ last_full: "2026-10-31", today_theirs: false }));
    expect(streak).toMatchObject({ days: 5, alive: true, todayDone: false, todayMine: true, todayTheirs: false });
  });

  it("goes out after a whole day without both writing, and says so the next day only", () => {
    expect(readStreak(row({ last_full: "2026-10-30", today_mine: false, today_theirs: false }))).toMatchObject({
      days: 0,
      alive: false,
      lost: 5,
    });
    expect(readStreak(row({ last_full: "2026-10-20" })).lost).toBe(0);
  });

  it("crosses month and year boundaries", () => {
    expect(readStreak(row({ last_full: "2026-12-31", today: "2027-01-01" })).alive).toBe(true);
    expect(readStreak(row({ last_full: "2027-02-27", today: "2027-03-01" })).alive).toBe(false);
  });

  it("never shows a record below the current run", () => {
    expect(readStreak(row({ run_days: 8, record_days: 3 })).record).toBe(8);
  });
});

describe("levels and words", () => {
  it("starts at two days and grows", () => {
    expect(streakLevel(1)).toBeNull();
    expect(streakLevel(2)?.name).toBe("Искорка");
    expect(streakLevel(6)?.name).toBe("Огонёк");
    expect(streakLevel(7)?.name).toBe("Костёр");
    expect(streakLevel(400)?.name).toBe("Солнце");
    expect(nextStreakLevel(7)?.name).toBe("Пламя");
    expect(nextStreakLevel(365)).toBeNull();
  });

  it("shows a badge only for a real streak or one that just went out", () => {
    expect(streakShown(readStreak(row({ run_days: 1 })))).toBe(false);
    expect(streakShown(readStreak(row({ run_days: 2 })))).toBe(true);
    expect(streakShown(readStreak(row({ last_full: "2026-10-30" })))).toBe(true);
    expect(streakShown(undefined)).toBe(false);
  });

  it("writes the badge and the label", () => {
    expect(streakBadge(readStreak(row({ run_days: 7 })))).toBe("🏕️7");
    expect(streakBadge(readStreak(row({ last_full: "2026-10-30" })))).toBe("🧊");
    const pending = readStreak(row({ last_full: "2026-10-31", run_days: 3 }));
    expect(streakLabel(pending, 12)).toBe("Огонёк дружбы: 3 дня подряд. Сегодня ещё не засчитан");
    expect(streakLabel(pending, 21)).toMatch(/Погаснет в полночь/);
    expect(dayWord(1)).toBe("день");
    expect(dayWord(4)).toBe("дня");
    expect(dayWord(11)).toBe("дней");
    expect(dayWord(21)).toBe("день");
  });
});

describe("demoStreakRows", () => {
  const now = new Date(2026, 10, 1, 15, 0);
  const at = (hours: number) => now.getTime() - hours * 3_600_000;
  const chat = (id: number, messages: { mine?: boolean; createdAt: number }[], extra: Partial<Chat> = {}): Chat =>
    ({
      id,
      name: `chat ${id}`,
      avatar: "",
      color: "blue",
      preview: "",
      time: "",
      messages: messages.map((message, index) => ({ id: index, author: "", text: "", time: "", ...message })),
      ...extra,
    }) as Chat;

  it("adds today when both wrote today, and not otherwise", () => {
    const rows = demoStreakRows(
      [chat(1, [{ createdAt: at(1) }, { mine: true, createdAt: at(0.5) }]), chat(2, [{ createdAt: at(1) }])],
      { 1: { run: 6, record: 6 }, 2: { run: 3, record: 9 } },
      now
    );
    expect(readStreak(rows.get(1)!)).toMatchObject({ days: 7, todayDone: true, record: 7 });
    expect(readStreak(rows.get(2)!)).toMatchObject({ days: 3, todayDone: false, todayTheirs: true, todayMine: false, record: 9 });
  });

  it("ignores yesterday's messages, groups and chats without a past", () => {
    const rows = demoStreakRows(
      [chat(1, [{ createdAt: at(20) }, { mine: true, createdAt: at(19) }]), chat(2, [], { group: true }), chat(3, [])],
      { 1: { run: 2, record: 2 }, 2: { run: 5, record: 5 } },
      now
    );
    expect(rows.get(1)?.today_mine).toBe(false);
    expect(rows.has(2)).toBe(false);
    expect(rows.has(3)).toBe(false);
  });
});

describe("streakViews and celebration", () => {
  const chat = (id: number, remoteId: string, extra: Partial<Chat> = {}): Chat =>
    ({ id, remoteId, name: `Чат ${id}`, avatar: "", color: "blue", preview: "", time: "", messages: [], ...extra }) as Chat;
  const evening = new Date(2026, 10, 1, 21);

  it("writes ready badges, with an hourglass on an unfinished evening", () => {
    const views = streakViews(
      [chat(1, "a"), chat(2, "b"), chat(3, "c", { group: true })],
      [row({ chat_id: "a", last_full: "2026-10-31", run_days: 3 }), row({ chat_id: "b", run_days: 1 }), row({ chat_id: "c" })],
      evening
    );
    expect(views.get(1)).toMatchObject({ text: "🔥3⏳", pending: true, shown: true });
    expect(views.get(2)?.shown).toBe(false);
    expect(views.has(3)).toBe(false);
  });

  it("celebrates a level once, and never on first sight", () => {
    window.localStorage.clear();
    const chats = [chat(1, "a", { name: "Аня" })];
    const memory: Record<string, number> = {};
    const at = (run: number, lastFull = "2026-11-01") => streakViews(chats, [row({ chat_id: "a", run_days: run, last_full: lastFull })], evening);
    expect(celebration(chats, at(6, "2026-10-31"), memory)).toBeNull();
    expect(celebration(chats, at(7), memory)?.message).toBe("🏕️ Костёр! 7 дней подряд в чате «Аня»");
    expect(celebration(chats, at(7), memory)).toBeNull();
    expect(celebration(chats, at(8), memory)).toBeNull();
  });

  it("celebrates the first spark of a chat it already knew at one day", () => {
    window.localStorage.clear();
    const chats = [chat(1, "a", { name: "Игорь" })];
    const memory: Record<string, number> = {};
    expect(celebration(chats, streakViews(chats, [row({ chat_id: "a", run_days: 1, last_full: "2026-10-31" })], evening), memory)).toBeNull();
    expect(celebration(chats, streakViews(chats, [row({ chat_id: "a", run_days: 2 })], evening), memory)?.message).toMatch(/^✨ Искорка! 2 дня/);
  });
});
