/**
 * Game invitations inside a chat.
 *
 * A message that says "let's play chess" is a message. An invitation is a thing with a game in
 * it, a state that changes, and a button that opens that game. The previous version drew a Dota 2
 * card on the last message of the first demo chat and, when it was pressed, said an invitation
 * would appear soon.
 *
 * What this covers and what it does not: the invitation is stored in the message text in a form
 * the app recognises, so it survives a reload and reaches the other side as an ordinary message.
 * Two people on two devices still do not share a board - that needs a server room - and the
 * invitation says so instead of pretending otherwise.
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
 * The honest note under the button.
 *
 * Two people in the same chat still cannot share a board, and a card that implies otherwise wastes
 * a player's time: they accept and then find their own separate game.
 */
export function invitationNote(): string {
  return "Партия начнётся на вашем устройстве. Совместная игра по сети пока не подключена.";
}

/** A message that is only a game invitation, which the chat list shows differently. */
export function invitationPreview(text: string): string | null {
  const invitation = parseInvitation(text);
  if (!invitation) return null;
  return `${gameName(invitation.kind)}: приглашение`;
}
