/**
 * Group calls.
 *
 * The signalling table already belongs to a chat rather than to a pair, so a group
 * call needs no new backend rule: every member may answer, and the SFU room holds
 * however many people join. What was missing is the surface that makes a group call
 * legible — who is in it, and how to bring someone else in.
 */

/** What the in-call screen shows about the people on the call. */
export type RoomParticipant = {
  identity: string;
  name: string;
  /** Why they are shown but not speaking. */
  muted?: boolean;
};

/**
 * Whether a call counts as a group call.
 *
 * The list includes the caller, so two people on the line is still a one-to-one
 * call and keeps the familiar single-avatar screen. The screen only has to show
 * faces once somebody else joins, and the threshold lives here rather than being
 * re-derived in the component.
 */
export function isGroupCall(participants: RoomParticipant[]): boolean {
  return participants.length > 2;
}

/** The initials shown when a participant has no camera. */
export function participantInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "?";
  // Code points, not UTF-16 units: an emoji name must not be sliced in half.
  return Array.from(trimmed)[0].toUpperCase();
}

/** A short stand-in name for someone whose profile has not loaded yet. */
export function participantLabel(participant: RoomParticipant): string {
  const name = participant.name.trim();
  return name === "" ? participant.identity.slice(0, 8) : name;
}

/**
 * The members of the chat who are not on the call yet.
 *
 * Excludes the caller: inviting yourself is not a thing you can do, and a button
 * that silently does nothing is worse than no button.
 */
export function inviteCandidates(
  members: { userId: string; name: string }[],
  participants: RoomParticipant[],
  selfId: string
): { userId: string; name: string }[] {
  const present = new Set(participants.map((participant) => participant.identity));
  return members.filter((member) => member.userId !== selfId && !present.has(member.userId));
}

/** "3 участника" for the header. */
export function pluralParticipants(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} участник`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} участника`;
  return `${count} участников`;
}
