/**
 * The invitation card drawn inside a message.
 *
 * It shows the game, both names, and a button that really opens that game. No invented times,
 * no invented players, no game that is not one of the three.
 *
 * Whether the game is shared is decided by whether the invitation carries an id, and the note under
 * the button says which it is. A card that promised a shared board for a local game would be worse
 * than one that promised nothing.
 */

import { Gamepad2, Send } from "lucide-react";
import {
  gameName,
  invitationAction,
  invitationNote,
  invitationText,
  type GameInvitation,
} from "../../games/core/invitation";

type GameInviteCardProps = {
  invitation: GameInvitation;
  viewerIsInvited: boolean;
  onOpen: () => void;
};

export default function GameInviteCard({ invitation, viewerIsInvited, onOpen }: GameInviteCardProps) {
  return (
    <div className="game-invite" data-online={invitation.gameId ? "true" : "false"}>
      <div className="game-invite-icon" aria-hidden="true">
        <Gamepad2 size={20} />
      </div>
      <div className="game-invite-body">
        <strong>{invitationText(invitation, viewerIsInvited)}</strong>
        <small>{invitationNote(invitation)}</small>
        <button type="button" className="btn btn-primary game-invite-button" onClick={onOpen}>
          <Send size={14} /> {invitationAction(invitation, viewerIsInvited)}
        </button>
      </div>
      <span className="game-invite-kind">{gameName(invitation.kind)}</span>
    </div>
  );
}
