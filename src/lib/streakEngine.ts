/**
 * «Огонёк дружбы»: days in a row both people in a direct chat wrote to each other.
 *
 * The counting is the database's (supabase/migrations/20261055_friendship_streaks.sql): it
 * keeps a note of who wrote when, so a purged or deleted message does not put the fire out,
 * and it answers in the reader's own time zone. What is here is the reading of that answer -
 * alive or out, done today or not, which level, what the badge says, when to celebrate.
 *
 * It is a chunk of its own, fetched only once there is a streak to show: the first screen
 * carries just the request (hooks/useStreaks.ts) and the drawing of a ready-made badge.
 */

import type { Chat } from "../types";
import { readItem, writeItem } from "./safeStorage";

/** One row of my_streaks(). Dates are YYYY-MM-DD in the reader's time zone. */
export type StreakRow = {
  chat_id: string;
  last_full: string;
  run_days: number;
  record_days: number;
  today: string;
  today_mine: boolean;
  today_theirs: boolean;
};

export type Streak = {
  /** Days in a row, counting today if both already wrote. Zero once it went out. */
  days: number;
  /** Still burning: both wrote today or yesterday. */
  alive: boolean;
  /** Both wrote today, so today already counts. */
  todayDone: boolean;
  todayMine: boolean;
  todayTheirs: boolean;
  record: number;
  /** A run that went out yesterday, to say so once; zero otherwise. */
  lost: number;
};

export type StreakLevel = { days: number; icon: string; name: string };

/** Where the fire grows. Two days is the first: one day in a row is just a day. */
export const STREAK_LEVELS: StreakLevel[] = [
  { days: 2, icon: "✨", name: "Искорка" },
  { days: 3, icon: "🔥", name: "Огонёк" },
  { days: 7, icon: "🏕️", name: "Костёр" },
  { days: 14, icon: "❤️‍🔥", name: "Пламя" },
  { days: 30, icon: "☄️", name: "Комета" },
  { days: 100, icon: "🌋", name: "Вулкан" },
  { days: 365, icon: "☀️", name: "Солнце" },
];

/** From this hour an unfinished day is "at risk", and the badge says so. */
export const STREAK_RISK_HOUR = 20;

export function streakLevel(days: number): StreakLevel | null {
  let found: StreakLevel | null = null;
  for (const level of STREAK_LEVELS) if (days >= level.days) found = level;
  return found;
}

export function nextStreakLevel(days: number): StreakLevel | null {
  return STREAK_LEVELS.find((level) => level.days > days) ?? null;
}

function dayNumber(iso: string): number {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function readStreak(row: StreakRow): Streak {
  const gap = dayNumber(row.today) - dayNumber(row.last_full);
  const alive = gap <= 1;
  return {
    days: alive ? row.run_days : 0,
    alive,
    todayDone: gap <= 0,
    todayMine: row.today_mine,
    todayTheirs: row.today_theirs,
    record: Math.max(row.record_days, row.run_days),
    lost: gap === 2 ? row.run_days : 0,
  };
}

/** Whether a streak is worth a badge: burning for two days or more, or out since yesterday. */
export function streakShown(streak: Streak | undefined): streak is Streak {
  return Boolean(streak && ((streak.alive && streak.days >= 2) || streak.lost >= 2));
}

/** A direct chat: two people. Groups and channels have no streak. */
export function isDirectChat(chat: Pick<Chat, "group" | "channel">): boolean {
  return !chat.group && !chat.channel;
}

/** The badge text, the same in the list and in the header: «🏕️7», or «🧊» once out. */
export function streakBadge(streak: Streak): string {
  if (!streak.alive) return "🧊";
  return `${streakLevel(streak.days)?.icon ?? "🔥"}${streak.days}`;
}

/** Said in words, for a screen reader and a tooltip. */
export function streakLabel(streak: Streak, hour: number): string {
  if (!streak.alive) return `Огонёк дружбы погас после ${streak.lost} ${dayWord(streak.lost)}`;
  const base = `Огонёк дружбы: ${streak.days} ${dayWord(streak.days)} подряд`;
  if (streak.todayDone) return base;
  return hour >= STREAK_RISK_HOUR ? `${base}. Погаснет в полночь, если сегодня не написать друг другу` : `${base}. Сегодня ещё не засчитан`;
}

export function dayWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "дней";
  if (ones === 1) return "день";
  if (ones >= 2 && ones <= 4) return "дня";
  return "дней";
}

function isoDay(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * The demo's streaks, from a made-up past and the messages on screen today: the demo has no
 * server, and the feature should still be something one can try - write to Максим and see the
 * fire grow to a bonfire.
 */
export function demoStreakRows(chats: Chat[], history: Record<number, { run: number; record: number }>, now: Date): Map<number, StreakRow> {
  const rows = new Map<number, StreakRow>();
  const today = isoDay(now);
  const yesterday = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  for (const chat of chats) {
    const past = history[chat.id];
    if (!past || !isDirectChat(chat)) continue;
    const todays = chat.messages.filter((message) => message.createdAt && isoDay(new Date(message.createdAt)) === today);
    const mine = todays.some((message) => message.mine);
    const theirs = todays.some((message) => !message.mine);
    const done = mine && theirs;
    rows.set(chat.id, {
      chat_id: String(chat.id),
      last_full: done ? today : yesterday,
      run_days: past.run + (done ? 1 : 0),
      record_days: Math.max(past.record, past.run + (done ? 1 : 0)),
      today,
      today_mine: mine,
      today_theirs: theirs,
    });
  }
  return rows;
}

/** What the list and the header draw: worked out here, so they carry no logic of their own. */
export type StreakView = {
  /** «🏕️7», «🔥6⏳», «🧊». */
  text: string;
  /** The same in words, for a screen reader and a tooltip. */
  label: string;
  /** Today does not count yet: the badge is dimmed. */
  pending: boolean;
  /** Worth a badge at all; the others are kept so a first spark can be celebrated. */
  shown: boolean;
  streak: Streak;
};

/**
 * A made-up past for the demo, by chat id: days in a row both wrote up to yesterday, and the
 * record. Today is read from the messages on screen, so writing to Максим turns his six days
 * into a seven-day bonfire, and writing to Игорь lights the first spark.
 */
export const DEMO_STREAKS: Record<number, { run: number; record: number }> = {
  1: { run: 6, record: 9 },
  2: { run: 1, record: 4 },
  3: { run: 12, record: 12 },
};

/**
 * The badges for these chats: from the server's rows by remote id, or - in the demo, where
 * `rows` is null - from the made-up past and today's messages.
 */
export function streakViews(chats: Chat[], rows: StreakRow[] | null, now: Date): Map<number, StreakView> {
  const views = new Map<number, StreakView>();
  const byChat = new Map<number, StreakRow>();
  if (rows) {
    const byRemote = new Map(rows.map((row) => [row.chat_id, row]));
    for (const chat of chats) {
      const row = chat.remoteId && isDirectChat(chat) ? byRemote.get(chat.remoteId) : undefined;
      if (row) byChat.set(chat.id, row);
    }
  } else {
    for (const [id, row] of demoStreakRows(chats, DEMO_STREAKS, now)) byChat.set(id, row);
  }
  const hour = now.getHours();
  for (const [id, row] of byChat) {
    const streak = readStreak(row);
    const pending = streak.alive && !streak.todayDone;
    views.set(id, {
      text: streakBadge(streak) + (pending && hour >= STREAK_RISK_HOUR ? "⏳" : ""),
      label: streakLabel(streak, hour),
      pending,
      shown: streakShown(streak),
      streak,
    });
  }
  return views;
}

const SEEN_KEY = "nexus.streakLevels";

/** The level each chat was last seen at, so a level is celebrated once. */
export function readSeenLevels(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(readItem(SEEN_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * A level reached while watching, to celebrate - or null. Updates `memory` and stores it.
 *
 * The first sight of a chat is only remembered: a fire that was already a bonfire yesterday
 * is not news today. A fire that went out starts again from nothing.
 */
export function celebration(
  chats: Chat[],
  views: Map<number, StreakView>,
  memory: Record<string, number>
): { chatId: number; message: string } | null {
  let changed = false;
  let found: { chatId: number; message: string } | null = null;
  for (const chat of chats) {
    if (!isDirectChat(chat)) continue;
    const key = chat.remoteId ?? `local:${chat.id}`;
    const streak = views.get(chat.id)?.streak;
    const level = streak?.alive ? streakLevel(streak.days) : null;
    const reached = level?.days ?? 0;
    const before = memory[key];
    if (before === reached || (before === undefined && !streak)) continue;
    memory[key] = reached;
    changed = true;
    if (before !== undefined && reached > before && level && streak?.todayDone && !found) {
      found = { chatId: chat.id, message: `${level.icon} ${level.name}! ${streak.days} ${dayWord(streak.days)} подряд в чате «${chat.name}»` };
    }
  }
  if (changed) writeItem(SEEN_KEY, JSON.stringify(memory));
  return found;
}
