/**
 * Sending later.
 *
 * The decision that shapes this file: the timer does not live in the browser. A message
 * waiting in a tab is lost when the tab closes, and losing a message quietly is worse than
 * not offering the feature. So the scheduled moment is stored on the row and the row is
 * invisible to everyone else until it passes; the check is in SQL.
 *
 * What the browser still does is offer times. A date picker is the wrong first question:
 * people scheduling a message almost always mean one of a handful of moments, and typing a
 * date into a form to say "tomorrow morning" is work.
 */

export const DEFAULT_SCHEDULE_MINUTES = 60;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type ScheduleChoice = {
  /** What the button says. */
  label: string;
  /** The moment it means. */
  at: Date;
};

export type SchedulePreset = {
  label: string;
  minutes: number;
};

/** The first moment that is comfortably in the future, today or tomorrow. */
function atHour(now: Date, hour: number, minute = 0): Date {
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target;
}

/**
 * The choices offered, in the order they are shown: quickly, then by the shape of a day.
 *
 * Nine in the morning is a real preference for a morning message — it is when "tomorrow
 * morning" means to most people, not midnight.
 */
export function scheduleChoices(now: Date): ScheduleChoice[] {
  const inHours = (hours: number) => new Date(now.getTime() + hours * HOUR);
  const choices: ScheduleChoice[] = [
    { label: "Через 1 час", at: inHours(1) },
    { label: "Через 3 часа", at: inHours(3) },
    { label: "Вечером, в 19:00", at: atHour(now, 19) },
    { label: "Завтра утром, в 9:00", at: atHour(now, 9) },
    { label: "Через неделю", at: new Date(now.getTime() + 7 * DAY) },
  ];
  // Two presets can land on the same moment (three hours from 6:00 is 9:00). Keeping both
  // would show two buttons that do the same thing, which reads as a bug.
  const seen = new Set<number>();
  return choices
    .filter((choice) => {
      const key = Math.floor(choice.at.getTime() / MINUTE);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((choice) => choice.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Short presets for a tooltip or a compact menu. */
export function nextPresets(now: Date): SchedulePreset[] {
  return [
    { label: "Через 15 минут", minutes: 15 },
    { label: "Через час", minutes: 60 },
    { label: "Завтра", minutes: 24 * 60 },
  ].filter((preset) => new Date(now.getTime() + preset.minutes * MINUTE).getTime() > now.getTime());
}

/** Reads the stored moment. Null for a message that was never scheduled. */
export function parseSendAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Whether a scheduled message is still waiting. */
export function isScheduled(value: string | null | undefined, now: Date): boolean {
  const at = parseSendAt(value);
  return at !== null && at.getTime() > now.getTime();
}

/** "сегодня в 19:00", "завтра в 9:00", or a date for anything further away. */
export function formatSendAt(at: Date, now: Date): string {
  const time = at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(at, now)) return `сегодня в ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(at, tomorrow)) return `завтра в ${time}`;
  const date = at.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return `${date} в ${time}`;
}
