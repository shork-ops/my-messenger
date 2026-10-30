/**
 * Stickers.
 *
 * A sticker is a message whose whole content is a picture, so the set lives in the bundle
 * rather than behind a URL. That is a deliberate trade: a real sticker platform serves
 * hundreds of megabytes from a CDN, and a messenger for close people cannot afford to have
 * its pictures break when a third party reorganises its storage. Drawing the stickers
 * ourselves is also what makes them searchable in Russian, by the words people would
 * actually say.
 */

export type Sticker = {
  /** Stable identifier stored with the message. Never reuse an id for different art. */
  id: string;
  /** The artwork. A text glyph, so it scales, prints and needs no image request. */
  glyph: string;
  /** A tint for the sticker's circle, from the theme's palette. */
  tone: string;
  /** The moment it expresses, used as the accessible label and the tooltip. */
  label: string;
  /** Words to search by. Russian, because that is what the search field is typed in. */
  words: string[];
};

export const STICKERS: Sticker[] = [
  { id: "hi", glyph: "👋", tone: "yellow", label: "Привет", words: ["привет", "здравствуй", "здорово"] },
  { id: "hug", glyph: "🤗", tone: "green", label: "Обнимаю", words: ["обнимаю", "обнять", "обнимашки"] },
  { id: "love", glyph: "❤️", tone: "red", label: "Люблю", words: ["люблю", "любовь", "сердце"] },
  { id: "kiss", glyph: "😘", tone: "pink", label: "Целую", words: ["целую", "поцелуй", "чмок"] },
  { id: "laugh", glyph: "😂", tone: "yellow", label: "Смеюсь до слёз", words: ["смеюсь", "смех", "смешно", "ахаха"] },
  { id: "thanks", glyph: "🙏", tone: "violet", label: "Спасибо", words: ["спасибо", "благодарю", "признателен"] },
  { id: "ok", glyph: "👌", tone: "green", label: "Хорошо", words: ["хорошо", "ок", "окей", "договорились"] },
  { id: "yes", glyph: "👍", tone: "green", label: "Да", words: ["да", "согласен", "подтверждаю"] },
  { id: "no", glyph: "👎", tone: "red", label: "Нет", words: ["нет", "против", "не согласен"] },
  { id: "think", glyph: "🤔", tone: "grey", label: "Думаю", words: ["думаю", "размышляю", "хм"] },
  { id: "sleep", glyph: "😴", tone: "blue", label: "Сплю", words: ["сплю", "сон", "устал", "ночь"] },
  { id: "work", glyph: "💻", tone: "blue", label: "Работаю", words: ["работаю", "работа", "код", "задача"] },
  { id: "coffee", glyph: "☕", tone: "brown", label: "Кофе", words: ["кофе", "перерыв", "утро"] },
  { id: "party", glyph: "🎉", tone: "violet", label: "Праздник", words: ["праздник", "ура", "поздравляю", "победа"] },
  { id: "sad", glyph: "😔", tone: "blue", label: "Грустно", words: ["грустно", "печаль", "жаль"] },
  { id: "cry", glyph: "😭", tone: "blue", label: "Плачу", words: ["плачу", "слёзы", "рыдаю"] },
  { id: "angry", glyph: "😠", tone: "red", label: "Злюсь", words: ["злюсь", "злость", "бесит"] },
  { id: "cool", glyph: "😎", tone: "yellow", label: "Круто", words: ["круто", "класс", "супер"] },
  { id: "wink", glyph: "😉", tone: "pink", label: "Подмигиваю", words: ["подмигиваю", "шучу", "хитро"] },
  { id: "hurry", glyph: "🏃", tone: "orange", label: "Бегу", words: ["бегу", "спешу", "скоро", "опаздываю"] },
  { id: "wait", glyph: "⏳", tone: "grey", label: "Подожди", words: ["подожди", "минуту", "погоди"] },
  { id: "call", glyph: "📞", tone: "green", label: "Позвони", words: ["позвони", "звонок", "связь"] },
  { id: "food", glyph: "🍕", tone: "orange", label: "Еда", words: ["еда", "обед", "пицца", "голоден"] },
  { id: "cake", glyph: "🎂", tone: "pink", label: "День рождения", words: ["день рождения", "торт", "поздравляю"] },
  { id: "flower", glyph: "🌷", tone: "pink", label: "Цветок", words: ["цветок", "весна", "красиво"] },
  { id: "fire", glyph: "🔥", tone: "orange", label: "Огонь", words: ["огонь", "жара", "важно"] },
  { id: "star", glyph: "⭐", tone: "yellow", label: "Звезда", words: ["звезда", "отлично", "лучшее"] },
  { id: "moon", glyph: "🌙", tone: "violet", label: "Спокойной ночи", words: ["ночи", "спокойной", "пока"] },
  { id: "rocket", glyph: "🚀", tone: "violet", label: "Поехали", words: ["поехали", "начали", "старт"] },
  { id: "heart-eyes", glyph: "😍", tone: "red", label: "Восхищаюсь", words: ["восхищаюсь", "нравится", "влюблён"] },
];

const BY_ID = new Map(STICKERS.map((sticker) => [sticker.id, sticker]));

/** Looks a sticker up by the id stored on a message. Undefined for an id this build lacks. */
export function stickerById(id: string): Sticker | undefined {
  return BY_ID.get(id);
}

/** Whether this build can draw the sticker a message refers to. */
export function isSticker(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Finds stickers by the words people would type.
 *
 * Prefix matching rather than substring: typing "об" should find "обнимаю" and not every
 * sticker whose word happens to contain those letters somewhere in the middle.
 */
export function searchStickers(query: string): Sticker[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return STICKERS;
  return STICKERS.filter((sticker) =>
    sticker.words.some((word) => word.toLowerCase().startsWith(needle)) || sticker.label.toLowerCase().startsWith(needle)
  );
}

/** The pack as the picker shows it: one set, with a name for the heading. */
export function stickerPack(): { name: string; stickers: Sticker[] } {
  return { name: "Повседневные", stickers: STICKERS };
}

/**
 * How a sticker travels in a message body.
 *
 * The body is the only column every message already has, and adding a column for each new
 * kind of content would mean a migration every time. A reserved prefix keeps stickers
 * unmistakable in a body that otherwise holds text: no one types this, and a text message
 * that did would still read as text rather than break.
 */
const MARKER = "\u0001sticker:";

/** The body a sticker message stores. */
export function stickerMarkup(id: string): string {
  return `${MARKER}${id}`;
}

/** The sticker id carried by a message body, or null for ordinary text. */
export function stickerFromBody(body: string): string | null {
  if (!body.startsWith(MARKER)) return null;
  const id = body.slice(MARKER.length).trim();
  return id === "" ? null : id;
}
