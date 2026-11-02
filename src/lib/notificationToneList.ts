import type { ToneId } from "./notificationTones";

/** Names shown in settings. Kept apart from the tones so the first screen does not carry them. */
export const TONE_CHOICES: { id: ToneId; label: string }[] = [
  { id: "chime", label: "Перезвон" },
  { id: "drop", label: "Капля" },
  { id: "bell", label: "Колокольчик" },
  { id: "trill", label: "Трель" },
  { id: "soft", label: "Мягкий" },
];
