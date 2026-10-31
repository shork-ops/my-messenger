/**
 * Opening the game an invitation points at.
 *
 * An invitation is sent before anybody has played, so the sender has to create the room and the
 * starting position first. The position comes from the same engines that will draw the board, so
 * there is no second copy of the setup rules on the server: the seed is chosen here, the state is
 * built here, and the server stores it verbatim.
 *
 * Kept out of `useMessenger` so it can be tested without mounting a messenger, and so the answer to
 * "what is the starting state of the card game" is in one place rather than inline in an event
 * handler.
 */

import { createServerGame, type NetworkError, type NetworkResult } from "./gameServer";
import { CHESS_RULES_VERSION, createChessSession } from "../chess/session";
import { newCardState } from "../cards/deck";
import { baldaEngine, createBalda } from "../balda/engine";
import { DICTIONARY_VERSION, dictionaryMeta } from "../balda/dictionary";
import type { GameKind } from "./types";

/** How many people a fresh invitation expects. */
export function seatsFor(kind: GameKind): number {
  // Chess and «Балда» are two-player games. The card game is offered at two because an invitation
  // goes to one chat, and a table that waits for four people who may not all be there never starts;
  // the server accepts up to four, and the join path fills whatever is free.
  return 2;
}

/** The rules version a new networked game is played under, stored with it. */
export function rulesVersionFor(kind: GameKind): number {
  if (kind === "chess") return CHESS_RULES_VERSION;
  if (kind === "balda") return baldaEngine.rulesVersion;
  return 1;
}

/**
 * A fresh starting position for a networked game.
 *
 * The players are the two seats' names as they will appear on the board. The seed is random and
 * travels inside the state: that is what makes the shuffle verifiable later, because anyone holding
 * the record can regenerate the same deck.
 */
export function initialNetworkState(kind: GameKind, playerNames: [string, string], seed: number): unknown {
  if (kind === "chess") {
    return createChessSession({
      // "friend" is what makes `botColor` null - a bot colour would make the screen tell both
      // players they are sitting on the bot's side.
      mode: "friend",
      difficulty: "normal",
      players: { white: playerNames[0], black: playerNames[1] },
    });
  }
  if (kind === "cards") {
    // The card engine identifies players by id, and the ids have to be stable across both screens,
    // so they are the seat names rather than anything local to one device.
    return newCardState([playerNames[0], playerNames[1]], seed);
  }
  return createBalda({ players: [], seed });
}

/**
 * Opens a shared game for an invitation and returns its id.
 *
 * The caller decides what to do with a failure. This function does not fall back to a local game
 * itself, because the honest fallback is not "pretend" - it is to send the invitation without an
 * id, which the note under the button then describes accurately.
 */
export async function openInvitedGame(
  kind: GameKind,
  chatId: string,
  opponentName: string,
  random: () => number = Math.random
): Promise<NetworkResult<string>> {
  const seed = Math.floor(random() * 2 ** 31);
  const state = initialNetworkState(kind, ["Вы", opponentName], seed);
  const isBalda = kind === "balda";
  return createServerGame({
    chatId,
    kind,
    seats: seatsFor(kind),
    initialState: state,
    rulesVersion: rulesVersionFor(kind),
    dictionaryVersion: isBalda ? DICTIONARY_VERSION : null,
    dictionaryChecksum: isBalda ? dictionaryMeta().checksum : null,
  });
}

export type { NetworkError, NetworkResult };
