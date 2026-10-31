/**
 * Game invitations inside a chat.
 *
 * A message that says "let's play chess" is a message. An invitation is a thing with a game in
 * it, a state that changes, and a button that opens that game. The previous version drew a Dota 2
 * card on the last message of the first demo chat and, when it was pressed, said an invitation
 * would appear soon.
 *
 * The sender opens a real game on the server first and puts its id in the message. The recipient
 * presses the button, the app joins that id, and from then on both screens read the same board from
 * the same place. The invitation is still an ordinary message - it survives a reload and needs no
 * special event type - but the id inside it is what makes it a shared game rather than a note.
 *
 * An invitation without an id is a legitimate state: it is what a signed-out sender produces, and
 * what an older client wrote. It opens the game locally, and `invitationNote` says so instead of
 * implying a shared board that does not exist.
 */

import type { GameKind } from "./types";

/** The marker that makes a message an invitation rather than prose. */
export const INVITE_PREFIX = "nexus-game:";

export type GameInvitation = {
  kind: GameKind;
  /** Who invited whom, as names, for a card both sides can read. */
  from: string;
  to: string;
  /** The saved game this invitation points at, if the sender already started one. */
  gameId: string | null;
};

const GAME_NAMES: Record<GameKind, string> = {
  chess: "Шахматы",
  cards: "Uno",
  balda: "Балда",
};

export function gameName(kind: GameKind): string {
  return GAME_NAMES[kind];
}

export function isGameKind(value: string): value is GameKind {
  return value === "chess" || value === "cards" || value === "balda";
}

/** The message text for an invitation. Kept human-readable so an older client shows a line. */
export function encodeInvitation(invitation: GameInvitation): string {
  const parts = [
    INVITE_PREFIX + invitation.kind,
    `от ${invitation.from}`,
    `кому ${invitation.to}`,
  ];
  if (invitation.gameId) parts.push(`игра ${invitation.gameId}`);
  return parts.join(" | ");
}

/**
 * Reads an invitation out of a message, or returns null.
 *
 * A malformed marker is not an invitation: half-believing a broken string would produce a card
 * pointing at a game that does not exist.
 */
export function parseInvitation(text: string): GameInvitation | null {
  if (!text.startsWith(INVITE_PREFIX)) return null;
  const segments = text.split("|").map((part) => part.trim());
  const head = segments[0];
  const kind = head.slice(INVITE_PREFIX.length).trim();
  if (!isGameKind(kind)) return null;

  const from = segments.find((part) => part.startsWith("от "))?.slice(3).trim();
  const to = segments.find((part) => part.startsWith("кому "))?.slice(5).trim();
  const gameId = segments.find((part) => part.startsWith("игра "))?.slice(5).trim() ?? null;
  if (!from || !to) return null;

  return { kind, from, to, gameId };
}

/** What the card says, from the point of view of the person reading it. */
export function invitationText(invitation: GameInvitation, viewerIsInvited: boolean): string {
  const name = gameName(invitation.kind);
  if (viewerIsInvited) return `${invitation.from} приглашает вас в «${name}»`;
  return `Вы пригласили ${invitation.to} в «${name}»`;
}

/** The label of the card's button. */
export function invitationAction(invitation: GameInvitation, viewerIsInvited: boolean): string {
  const name = gameName(invitation.kind);
  return viewerIsInvited ? `Играть в «${name}»` : `Открыть «${name}»`;
}

/**
 * The note under the button.
 *
 * It says which of the two things pressing the button will do, because they are not the same and
 * the difference is what decides whether the opponent is a person or a bot. A card that implied a
 * shared board for a local game wastes a player's time: they accept and then find their own
 * separate game, with nobody on the other side.
 */
export function invitationNote(invitation?: GameInvitation): string {
  if (invitation?.gameId) {
    return "Партия на сервере: ходы обоих игроков видны друг другу.";
  }
  return "Партия начнётся на вашем устройстве. Совместная игра по сети пока не подключена.";
}

/** A message that is only a game invitation, which the chat list shows differently. */
export function invitationPreview(text: string): string | null {
  const invitation = parseInvitation(text);
  if (!invitation) return null;
  return `${gameName(invitation.kind)}: приглашение`;
}
