export function numericId(uuid: string): number {
  return Number.parseInt(uuid.replace(/-/g, "").slice(0, 12), 16);
}

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function clockTime(now: Date = new Date()): string {
  return formatClock(now);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dateLabel(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return "Сегодня";
  if (sameDay(date, yesterday)) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  }).format(date);
}
