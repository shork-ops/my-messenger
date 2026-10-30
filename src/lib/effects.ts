import type { MessageEffect } from "../types";

/**
 * The message effects, in one place.
 *
 * The comparison against the larger messengers found effects in only three of nine, which
 * is an argument for having them rather than for dropping them. The original four were
 * written as four copies of the same markup with colours keyed to their position in the
 * menu; both of those break quietly when an effect is added, so the list lives here and the
 * buttons are drawn from it.
 */

export type EffectDefinition = {
  key: MessageEffect;
  /** Shown on the button. Every symbol is distinct, so the row reads at a glance. */
  symbol: string;
  /** The Russian name, used for the tooltip and the accessible label. */
  label: string;
  /** A full sentence for the effect picker, where there is room to explain. */
  description: string;
  /** A class suffix: the stylesheet keys colours and animations off `message-effect-<key>`. */
  tone: string;
};

export const EFFECTS: EffectDefinition[] = [
  {
    key: "sparkle",
    symbol: "✦",
    label: "искры",
    description: "Мелкие искры вокруг сообщения",
    tone: "sparkle",
  },
  {
    key: "hearts",
    symbol: "♥",
    label: "сердечки",
    description: "Сердечки всплывают над пузырём",
    tone: "hearts",
  },
  {
    key: "fireworks",
    symbol: "✧",
    label: "салют",
    description: "Короткий залп, как в праздник",
    tone: "fireworks",
  },
  {
    key: "glow",
    symbol: "✺",
    label: "сияние",
    description: "Тихое свечение в цвете темы",
    tone: "glow",
  },
  {
    key: "confetti",
    symbol: "🎉",
    label: "конфетти",
    description: "Бумажки осыпаются сверху",
    tone: "confetti",
  },
  {
    key: "snow",
    symbol: "❄",
    label: "снег",
    description: "Медленные снежинки",
    tone: "snow",
  },
  {
    key: "fire",
    symbol: "🔥",
    label: "огонь",
    description: "Тёплое пламя снизу пузыря",
    tone: "fire",
  },
  {
    key: "rainbow",
    symbol: "🌈",
    label: "радуга",
    description: "Перелив цвета по рамке",
    tone: "rainbow",
  },
  {
    key: "bounce",
    symbol: "🫧",
    label: "пузыри",
    description: "Лёгкое покачивание с пузырями",
    tone: "bounce",
  },
  {
    key: "shadow",
    symbol: "👻",
    label: "тень",
    description: "Мягкая тень, сообщение будто парит",
    tone: "shadow",
  },
];

/** Finds an effect by key. Undefined for a key this build does not know - a message saved
 *  by a newer version must not break the conversation. */
export function effectByKey(key: string): EffectDefinition | undefined {
  return EFFECTS.find((effect) => effect.key === key);
}

/** The keys in display order, useful for a picker or for validation. */
export function effectKeys(): MessageEffect[] {
  return EFFECTS.map((effect) => effect.key);
}
