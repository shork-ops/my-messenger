import { createBalda, allLegalWords, baldaEngine, readPath, findPath } from "./src/games/balda/engine.ts";
import { chooseBaldaMove } from "./src/games/balda/bot.ts";
const s = createBalda({ players: [], seed: 1 });
const t0 = Date.now();
const moves = allLegalWords(s.board, s.usedWords);
const ms = Date.now() - t0;
console.log("найдено слов:", moves.length, "за", ms, "мс");
console.log("примеры:", moves.slice(0, 10).map(m => m.word + "@" + m.square).join(", "));
const mv = chooseBaldaMove(s, "normal");
console.log("бот выбрал:", JSON.stringify(mv));
if (mv) {
  const r = baldaEngine.apply(s, { type: "place", square: mv.square, letter: mv.letter, word: mv.word });
  console.log("применено:", r.changed, "| очки:", r.state.scores, "| причина:", r.reason ?? "-");
}
