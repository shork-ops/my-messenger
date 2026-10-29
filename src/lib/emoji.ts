/**
 * Emoji search.
 *
 * Emoji have no names in the browser: a person looking for a hug types "обнять",
 * not U+1F917. Each entry therefore carries the words people actually use in
 * Russian and English, and search matches any of them.
 */

export type EmojiEntry = {
  char: string;
  /** Words a person would type to find it, in both languages. */
  words: string;
};

export const EMOJI: EmojiEntry[] = [
  { char: "😀", words: "улыбка смех радость grin smile happy" },
  { char: "😂", words: "слёзы смех смешно laughing joy lol" },
  { char: "🥹", words: "умиление слёзы радость touched" },
  { char: "😊", words: "улыбка мило blush smile" },
  { char: "😍", words: "влюблён любовь сердечки love heart eyes" },
  { char: "😘", words: "поцелуй kiss" },
  { char: "😎", words: "очки крутой cool sunglasses" },
  { char: "🤔", words: "думаю размышление think" },
  { char: "😅", words: "неловко пот sweat smile" },
  { char: "😭", words: "плачу слёзы грусть cry sad" },
  { char: "😢", words: "грусть слеза sad cry" },
  { char: "😡", words: "злость гнев angry mad" },
  { char: "🥺", words: "прошу умоляю пожалуйста please pleading" },
  { char: "😴", words: "спать сон устал sleep tired" },
  { char: "🤯", words: "взрыв мозга шок mind blown" },
  { char: "🤗", words: "обнять объятия hug" },
  { char: "🤝", words: "рукопожатие договорились handshake deal" },
  { char: "👍", words: "палец вверх хорошо лайк yes like thumbs up" },
  { char: "👎", words: "палец вниз плохо no dislike" },
  { char: "👏", words: "аплодисменты браво clap" },
  { char: "🙏", words: "спасибо пожалуйста прошу thanks please" },
  { char: "💪", words: "сила мышцы strong muscle" },
  { char: "✌️", words: "мир виктория peace" },
  { char: "🤞", words: "надеюсь удача fingers crossed" },
  { char: "❤️", words: "сердце любовь red heart love" },
  { char: "💔", words: "разбитое сердце broken heart" },
  { char: "💜", words: "сердце фиолетовое purple heart" },
  { char: "🔥", words: "огонь жарко fire hot" },
  { char: "⭐", words: "звезда star" },
  { char: "✨", words: "искры блеск sparkles" },
  { char: "🎉", words: "праздник поздравляю party celebrate" },
  { char: "🎂", words: "торт день рождения cake birthday" },
  { char: "🎁", words: "подарок gift present" },
  { char: "☕", words: "кофе чай coffee tea" },
  { char: "🍕", words: "пицца pizza food" },
  { char: "🍺", words: "пиво beer" },
  { char: "🌙", words: "луна ночь moon night" },
  { char: "☀️", words: "солнце день sun day" },
  { char: "🌧️", words: "дождь rain" },
  { char: "❄️", words: "снег холодно snow cold" },
  { char: "🐱", words: "кот кошка cat" },
  { char: "🐶", words: "собака пёс dog" },
  { char: "🚀", words: "ракета запуск rocket launch" },
  { char: "💡", words: "идея лампочка idea" },
  { char: "✅", words: "галочка готово check done" },
  { char: "❌", words: "крестик нет cross no" },
  { char: "⚠️", words: "внимание предупреждение warning" },
  { char: "📌", words: "закрепить пин pin" },
  { char: "💬", words: "сообщение чат message chat" },
  { char: "👋", words: "привет пока рука wave hello bye" },
];

/** The characters of the list, in order, as one line of text. */
export const ALL_EMOJI = EMOJI.map((entry) => entry.char);

/**
 * The emoji matching a query.
 *
 * Matching is on whole word prefixes, so "ко" finds the cat and the coffee but
 * "об" does not match "хорошо". An empty query returns everything, because the
 * picker is also browsed rather than only searched.
 */
export function searchEmoji(query: string, limit = 24): EmojiEntry[] {
  const needle = query.trim().toLowerCase();
  // Browsing shows the whole catalogue; only a search is capped, so a wide query
  // cannot push the panel past the screen.
  if (needle === "") return EMOJI;
  return EMOJI.filter((entry) => entry.words.split(" ").some((word) => word.startsWith(needle))).slice(0, limit);
}

/** Whether a query found nothing, which is worth saying rather than showing blank. */
export function isEmojiEmpty(query: string): boolean {
  return searchEmoji(query).length === 0;
}
