import { ChevronRight, FileText, Image as ImageIcon, LogOut, Plus, ShieldCheck, ShieldMinus, UserMinus, X } from "lucide-react";
import Avatar from "./Avatar";
import UserAvatar from "./UserAvatar";
import type { ChatMember } from "../lib/groupAdmin";
import { formatBytes } from "../lib/media";
import type { Chat, Message } from "../types";
import "../styles/chat-info.css";

/** How many pictures and files the panel shows before "all". */
const MEDIA_PREVIEW = 6;
const FILES_PREVIEW = 3;

/** What kind of conversation this is, in the words the header does not already use. */
export function chatKind(chat: Chat): string {
  const count = chat.members?.length ?? 0;
  if (chat.channel) return count > 0 ? `Канал · подписчиков: ${count}` : "Канал";
  if (chat.group) return count > 0 ? `Группа · участников: ${count}` : "Группа";
  return chat.remoteId ? "Личный облачный диалог" : "Локальный чат на этом устройстве";
}

/**
 * Pictures and files of the open chat, newest first, from what is loaded. View-once media
 * is left out: listing it here would be a second way to look at it.
 */
export function chatMedia(chat: Chat): { images: Message[]; files: Message[] } {
  const images: Message[] = [];
  const files: Message[] = [];
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    const attachment = message.attachment;
    if (!attachment || attachment.viewOnce) continue;
    if (attachment.type.startsWith("image/")) images.push(message);
    else if (!attachment.type.startsWith("audio/") && !attachment.type.startsWith("video/")) files.push(message);
  }
  return { images, files };
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
};

export type ChatInfoPanelProps = {
  profileName: string;
  profileAvatar: string;
  selfAvatarUrl?: string | null;
  /** The signed-in user's own "about" line, if they wrote one. */
  selfAbout?: string | null;
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
  /** Opens the gallery of pictures. */
  onOpenGallery: () => void;
  /** False when the download policy says pictures wait for a tap; only inline previews are drawn then. */
  autoloadMedia: boolean;
};

export default function ChatInfoPanel({
  profileName,
  profileAvatar,
  selfAvatarUrl,
  selfAbout,
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
  onOpenGallery,
  autoloadMedia,
}: ChatInfoPanelProps) {
  const isOwner = myRole === "owner";
  const isAdmin = myRole === "owner" || myRole === "admin";
  const listed = chat.group ? members : [];
  const { images, files } = chatMedia(chat);
  const realChat = chat.id !== 0;

  return (
    <aside className="right-panel" aria-label="О чате">
      <div className="right-heading">
        <span>О чате</span>
        <button className="mobile-close" onClick={onClose} aria-label="Закрыть сведения о чате">
          <X size={17} />
        </button>
      </div>

      {/* The header button is labelled "Профиль чата", so this is what it opens: the chat,
          not the reader's own card, which used to be all the panel showed. */}
      {realChat && (
        <section className="chat-info-card">
          {chat.avatarPath ? (
            <UserAvatar name={chat.name} letter={chat.avatar} avatarPath={chat.avatarPath} color={chat.color} />
          ) : (
            <Avatar color={chat.color}>{chat.avatar}</Avatar>
          )}
          <strong>{chat.name}</strong>
          <small>{chatKind(chat)}</small>
          {chat.channel && chat.handle && <small className="chat-info-handle">@{chat.handle}</small>}
          {chat.description && <p className="chat-info-about">{chat.description}</p>}
        </section>
      )}

      {/* Sections appear once there is something in them; an empty "Фото: 0" is noise. */}
      {realChat && images.length > 0 && (
        <section className="chat-info-section" aria-label="Фото">
          <div className="online-heading">
            <span>Фото</span>
            <b>{images.length}</b>
          </div>
          <div className="chat-info-media">
            {images.slice(0, MEDIA_PREVIEW).map((message) => {
              const attachment = message.attachment!;
              const src = attachment.thumbnail ?? (autoloadMedia ? attachment.data : "");
              return (
                <button key={message.id} type="button" onClick={onOpenGallery} aria-label={`Открыть фото ${attachment.name}`}>
                  {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <ImageIcon size={18} />}
                </button>
              );
            })}
          </div>
          <button type="button" className="chat-info-more" onClick={onOpenGallery}>
            Все фото <ChevronRight size={15} />
          </button>
        </section>
      )}

      {realChat && files.length > 0 && (
        <section className="chat-info-section" aria-label="Файлы">
          <div className="online-heading">
            <span>Файлы</span>
            <b>{files.length}</b>
          </div>
          <ul className="chat-info-files">
            {files.slice(0, FILES_PREVIEW).map((message) => {
              const attachment = message.attachment!;
              return (
                <li key={message.id}>
                  <FileText size={16} />
                  <span>
                    <strong>{attachment.name}</strong>
                    <small>
                      {formatBytes(attachment.size)} · {message.time}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
      {/* A direct chat has no one to invite; the row used to say so, which was only noise. */}
      {chat.group && (
        <button className="invite-row" onClick={onCreateInvite}>
          <span>
            <Plus size={22} />
          </span>
          Скопировать ссылку-приглашение
        </button>
      )}
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

      <div className="right-divider chat-info-self-divider" />
      <div className="online-heading">
        <span>Мой профиль</span>
      </div>
      <button className="profile-card" onClick={onOpenProfile} aria-label="Мой профиль — открыть настройки">
        <Avatar color="self" src={selfAvatarUrl}>{profileAvatar}</Avatar>
        <span>
          <strong>{profileName}</strong>
          <small>
            <i />В сети
          </small>
        </span>
        <ChevronRight size={22} className="yellow-icon" />
      </button>
      {selfAbout && <p className="profile-about">{selfAbout}</p>}

    </aside>
  );
}
