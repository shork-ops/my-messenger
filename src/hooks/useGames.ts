/**
 * Whether the games screen is open.
 *
 * The three games used to live here: a static chess board with a quiz, a card hand stored as
 * strings and edited with `filter`, and a text box that accepted any word as a «Балда» move.
 * All of that is gone. The games have their own engines in `src/games`, and their state belongs
 * to the screen that plays them, so this hook does one thing: it says whether the catalogue is
 * on screen.
 */

import { useState } from "react";

export function useGames() {
  const [activeGame, setActiveGame] = useState<string | null>(null);

  /** Opens the games catalogue. Kept as a named action because the launcher calls it. */
  function openGame(name = "Каталог") {
    setActiveGame(name);
  }

  return { activeGame, setActiveGame, openGame };
}
