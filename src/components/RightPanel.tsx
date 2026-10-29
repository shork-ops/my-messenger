import { ChevronRight, LogOut, Plus, ShieldCheck, ShieldMinus, UserMinus, X } from "lucide-react";
import Avatar from "./Avatar";
import UserAvatar from "./UserAvatar";
import type { ChatMember } from "../lib/groupAdmin";
import type { Chat } from "../types";

const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
};

type RightPanelProps = {
  profileName: string;
  profileAvatar: string;
  selfAvatarUrl?: string | null;
  chat: Chat;
  members: ChatMember[];
  myRole: string | null;
  onClose: () => void;
  onOpenProfile: () => void;
  onCreateInvite: () => void;
  onRotateInvite: () => void;
  onChangeRole: (userId: string, role: "admin" | "member") => void;
  onRemoveMember: (userId: string) => void;
  onLeaveGroup: () => void;

};

export default function RightPanel({
  profileName,
  profileAvatar,
  selfAvatarUrl,
  chat,
  members,
  myRole,
  onClose,
  onOpenProfile,
  onCreateInvite,
  onRotateInvite,
  onChangeRole,
  onRemoveMember,
  onLeaveGroup,

}: RightPanelProps) {
  const isOwner = myRole === "owner";
  const isAdmin = myRole === "owner" || myRole === "admin";
  const listed = chat.group ? members : [];

  return (
    <aside className="right-panel">
      <div className="right-heading">
        <span>Профиль</span>
        <button className="mobile-close" onClick={onClose} aria-label="Закрыть профиль">
          <X size={17} />
        </button>
      </div>
      <button className="profile-card" onClick={onOpenProfile}>
        <Avatar color="self" src={selfAvatarUrl}>{profileAvatar}</Avatar>
        <span>
          <strong>{profileName}</strong>
          <small>
            <i />В сети
          </small>
        </span>
        <ChevronRight size={22} className="yellow-icon" />
      </button>

      <div className="right-divider" />
      {chat.group && listed.length > 0 && (
        <>
          <div className="online-heading">
            <span>Участники чата</span>
            <b>{listed.length}</b>
          </div>
          <div className="friends-list">
            {listed.map((member) => {
              const name = member.display_name ?? "Пользователь";
              const isTargetOwner = member.role === "owner";
              const canPromote = isOwner && member.role === "member";
              const canDemote = isOwner && member.role === "admin";
              // Admins remove plain members; the owner may remove admins too.
              const canRemove =
                !isTargetOwner &&
                (isOwner || (myRole === "admin" && member.role === "member"));
              return (
                <div key={member.user_id} className="friend-row member-row">
                  <span className="friend-avatar-wrap">
                    <UserAvatar
                      name={name}
                      letter={name.slice(0, 1).toUpperCase()}
                      avatarPath={member.avatar_path}
                      color="blue"
                      small
                    />
                  </span>
                  <span className="member-copy">
                    <strong>{name}</strong>
                    <small>{ROLE_LABEL[member.role] ?? member.role}</small>
                  </span>
                  {(canPromote || canDemote || canRemove) && (
                    <span className="member-actions">
                      {canPromote && (
                        <button
                          type="button"
                          title="Сделать администратором"
                          aria-label={`Сделать ${name} администратором`}
                          onClick={() => onChangeRole(member.user_id, "admin")}
                        >
                          <ShieldCheck size={15} />
                        </button>
                      )}
                      {canDemote && (
                        <button
                          type="button"
                          title="Снять администратора"
                          aria-label={`Снять ${name} с должности администратора`}
                          onClick={() => onChangeRole(member.user_id, "member")}
                        >
                          <ShieldMinus size={15} />
                        </button>
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          title="Удалить из группы"
                          aria-label={`Удалить ${name} из группы`}
                          onClick={() => onRemoveMember(member.user_id)}
                        >
                          <UserMinus size={15} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <button className="invite-row" onClick={onCreateInvite}>
        <span>
          <Plus size={22} />
        </span>
        {chat.group ? "Скопировать ссылку-приглашение" : "Приглашение доступно в группах"}
      </button>
      {chat.group && isAdmin && (
        <button className="clear-history-button" onClick={onRotateInvite}>
          Обновить ссылку-приглашение
        </button>
      )}
      {chat.group && chat.remoteId && myRole !== null && myRole !== "owner" && (
        <button className="clear-history-button danger" onClick={onLeaveGroup}>
          <LogOut size={15} /> Покинуть группу
        </button>
      )}

    </aside>
  );
}
