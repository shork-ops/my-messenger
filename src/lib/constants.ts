export const friends = [
  { name: "Максим", avatar: "М", color: "blue" },
  { name: "Игорь", avatar: "И", color: "olive" },
  { name: "Аня", avatar: "А", color: "pink" },
  { name: "Сергей", avatar: "С", color: "orange" },
  { name: "Катя", avatar: "К", color: "pink" },
  { name: "Дима", avatar: "Д", color: "blue" },
  { name: "Настя", avatar: "Н", color: "pink" },
  { name: "Влад", avatar: "В", color: "olive" },
];

export const games = [
  { name: "Шахматы", desc: "Играть с друзьями", icon: "♟", cls: "chess" },
  { name: "Uno", desc: "Быстрая игра", icon: "UNO", cls: "uno" },
  { name: "Балда", desc: "Слова и друзья", icon: "А", cls: "balda" },
];

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

/** Fills the demo build with deterministic chats so browser tests can rely on them. */
export const demoSeedEnabled = import.meta.env.VITE_DEMO_SEED === "true";
