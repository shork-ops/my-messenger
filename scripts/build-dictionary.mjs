/**
 * Builds the «Балда» dictionary from a licensed source.
 *
 * Run with `npm run build:dictionary`. The input is the MIT-licensed Russian noun list from
 * https://github.com/Harrix/Russian-Nouns (see NOTICE.md in this directory), downloaded into
 * `scripts/data/russian_nouns.raw.txt`. The output is `src/games/balda/words.generated.ts`.
 *
 * Why a generation step rather than a hand-typed list: the previous dictionary was 3,713 words
 * chosen by hand with no recorded source. That is both unauditable (where did those words come
 * from?) and unfair (a word missing from a hand list looks to a player exactly like a word that is
 * not Russian). A generated list states its origin, its licence, and the exact filter applied.
 *
 * The filter is the game's rules written as code, and every rule is here for a reason:
 *
 * 1. **Nouns only.** The source is a noun list already; this is a check, not a transformation.
 * 2. **At least two letters.** «Балда» builds words by walking a path on the board, and the rules
 *    allow two-letter words (the plan says "от двух букв").
 * 3. **Only the board's alphabet.** A word with a letter the board can never show is unplayable, so
 *    carrying it would only add weight.
 * 4. **No leading ь/ъ/ы.** Russian has no word starting with these; if a source line does, it is a
 *    parsing artefact and admitting it would let an impossible board row score.
 * 5. **At least one vowel.** A consonant-only string is not a Russian word.
 * 6. **ё folded to е on both sides**, because the game treats them as one letter everywhere.
 *
 * What is deliberately NOT filtered: rare, technical, dialectal and borrowed words stay. The
 * source does not mark them reliably, and guessing at "common enough" would reintroduce the
 * arbitrariness this change exists to remove. The size and the source are shown in the rules screen,
 * so nobody assumes the list is complete.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE_PATH = new URL("./data/russian_nouns.raw.txt", import.meta.url);
const META_PATH = new URL("../src/games/balda/words.meta.ts", import.meta.url);
const DATA_PATH = new URL("../src/games/balda/words.data.ts", import.meta.url);

const ALPHABET = "абвгдежзийклмнопрстуфхцчшщъыьэюя";
const VOWELS = new Set("аеиоуыэюя".split(""));
const NO_LEADING = new Set(["ь", "ъ", "ы"]);
const MIN_LENGTH = 2;

const normalise = (word) => word.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");

/**
 * Reads a word-per-line file, ignoring blanks and `#` comments.
 *
 * The supplement file is documented in place with comments, so the reader has to skip them rather
 * than treat "#" as a word.
 */
function readWordFile(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

const sourceLines = readWordFile(SOURCE_PATH);
const supplementLines = readWordFile(new URL("./data/supplement.txt", import.meta.url));

/** Rejected words, counted by the rule that rejected them, so the build can report them. */
const rejected = { notAlphabet: 0, tooShort: 0, badLeading: 0, noVowel: 0, duplicate: 0 };

/** Checks the structural rules shared by both inputs. Returns the normalised word or null. */
function accept(line) {
  const word = normalise(line);

  // Rule 3: every letter must exist on the board.
  if (![...word].every((letter) => ALPHABET.includes(letter))) {
    rejected.notAlphabet += 1;
    return null;
  }
  // Rule 2.
  if (word.length < MIN_LENGTH) {
    rejected.tooShort += 1;
    return null;
  }
  // Rule 4.
  if (NO_LEADING.has(word[0])) {
    rejected.badLeading += 1;
    return null;
  }
  // Rule 5.
  if (![...word].some((letter) => VOWELS.has(letter))) {
    rejected.noVowel += 1;
    return null;
  }
  return word;
}

/** The licensed source, as a set. Kept separately so a supplement collision can be detected. */
const licensed = new Set();
for (const line of sourceLines) {
  const word = accept(line);
  if (word === null) continue;
  if (licensed.has(word)) {
    rejected.duplicate += 1;
    continue;
  }
  licensed.add(word);
}

/**
 * The supplement is added on top, and a word that is already in the licensed list is a mistake
 * rather than a harmless repeat: it would mean someone added a word the source already had, and the
 * comment claiming it fills a gap would be false. Reported as an error, not silently skipped.
 */
const supplement = [];
const supplementCollisions = [];
for (const line of supplementLines) {
  const word = accept(line);
  if (word === null) continue;
  if (licensed.has(word)) {
    supplementCollisions.push(word);
    continue;
  }
  if (supplement.includes(word)) {
    console.error(`Refusing: "${word}" appears twice in scripts/data/supplement.txt.`);
    process.exit(1);
  }
  supplement.push(word);
}

const words = new Set([...licensed, ...supplement]);

const sorted = [...words].sort((a, b) => a.localeCompare(b, "ru"));

/**
 * A checksum over the sorted list.
 *
 * Stored with the game so that two people playing the same "dictionary version 2" are provably
 * using the same words. Without it, a rebuilt dictionary would silently keep the old version number
 * and a networked game could disagree about whether a word counts.
 */
function checksum(list) {
  let hash = 0x811c9dc5;
  for (const word of list) {
    const line = `${word}\n`;
    for (let index = 0; index < line.length; index += 1) {
      hash ^= line.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

const digest = checksum(sorted);

/** Lines of ~110 characters, so the generated file is diffable rather than one enormous line. */
function wrap(list, perLine = 10) {
  const lines = [];
  for (let index = 0; index < list.length; index += perLine) {
    lines.push("  " + list.slice(index, index + perLine).join(" "));
  }
  return lines.join("\n");
}

/**
 * Splits the output in two files.
 *
 * The word text is ~965 KB, and it must not sit in the `GameModal` chunk that a player downloads when
 * they open the game list: the plan requires that the dictionary and the bots do not block the chat.
 * `words.meta.ts` is tiny and safe to import anywhere (version, counts, checksum); `words.data.ts`
 * holds only the string, and is pulled in with `import()` while the panel shows its loading state.
 *
 * The generated split exists so the manual step is a decision made once in the generator rather than
 * a rule someone has to remember.
 */
const metaHeader = `/**
 * Metadata for the «Балда» dictionary. **Generated - do not edit by hand.**
 *
 * Kept in a separate, tiny module from the word list so that the rules screen and a networked game's
 * pre-flight check can read the version, size and checksum without pulling in ~965 KB of words.
 *
 * Source: Russian-Nouns by Sergienko Anton, https://github.com/Harrix/Russian-Nouns
 * Licence: MIT (Copyright © 2018-present Sergienko Anton). Full notice in \`scripts/data/NOTICE.md\`.
 * Words: ${sorted.length} (${licensed.size} licensed + ${supplement.length} added).
 */

/** Which list this is. A saved game keeps the version it was started with. */
export const WORDS_VERSION = 2;

/** Fingerprint of the word list, for proving two players are using the same dictionary. */
export const WORDS_CHECKSUM = "${digest}";

/** Every letter the board can contain. */
export const WORDS_ALPHABET = "${ALPHABET}";

/** How many words in total, and how the total splits between licensed and added. */
export const WORDS_TOTAL_COUNT = ${sorted.length};
export const WORDS_LICENSED_COUNT = ${licensed.size};
export const WORDS_SUPPLEMENT_COUNT = ${supplement.length};
`;

const dataHeader = `/**
 * The «Балда» word list. **Generated - do not edit by hand.**
 *
 * Loaded on demand - see \`words.meta.ts\` for why this is a separate module. Nothing should import
 * this file except \`dictionary.ts\`.
 *
 * Source: Russian-Nouns by Sergienko Anton, https://github.com/Harrix/Russian-Nouns
 * Licence: MIT (Copyright © 2018-present Sergienko Anton). Full notice in \`scripts/data/NOTICE.md\`.
 * Generated from \`dist/russian_nouns.txt\` (branch \`main\`) plus \`scripts/data/supplement.txt\`.
 *
 * ${sorted.length} words. Filter: nouns, at least ${MIN_LENGTH} letters, only letters from the board
 * alphabet, no leading ь/ъ/ы, at least one vowel, ё folded to е.
 */

export const WORDS = \`
${wrap(sorted)}
\`;
`;

writeFileSync(META_PATH, metaHeader, "utf8");
writeFileSync(DATA_PATH, dataHeader, "utf8");

console.log(`dictionary: ${sorted.length} words (${licensed.size} licensed + ${supplement.length} supplement), checksum ${digest}`);
console.log(`wrote ${META_PATH.pathname.split("/").pop()} and ${DATA_PATH.pathname.split("/").pop()}`);
console.log(`source lines: ${sourceLines.length}, supplement lines: ${supplementLines.length}`);
console.log(`rejected: ${JSON.stringify(rejected)}`);
if (supplementCollisions.length > 0) {
  console.error(
    `Refusing: these supplement words are already in the licensed list, so the comment saying they ` +
      `fill a gap is wrong: ${supplementCollisions.join(", ")}`
  );
  process.exit(1);
}
if (sorted.length < 40000) {
  console.error("Refusing: fewer than 40000 words survived the filter, which suggests a broken download.");
  process.exit(1);
}
