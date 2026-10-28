import { ChevronRight, Gamepad2, Plus, X } from "lucide-react";
import Avatar from "./Avatar";
import { games } from "../lib/constants";
import type { Chat } from "../types";

type RightPanelProps = {
  profileName: string;
  profileAvatar: string;
  chat: Chat;
  onClose: () => void;
  onOpenProfile: () => void;
  onCreateInvite: () => void;
  onClearHistory: () => void;
  onOpenGames: () => void;
  onOpenGame: (name: string) => void;
};

export default function RightPanel({
  profileName,
  profileAvatar,
  chat,
  onClose,
  onOpenProfile,
  onCreateInvite,
  onClearHistory,
  onOpenGames,
  onOpenGame,
}: RightPanelProps) {
  return (
    <aside className="right-panel">
      <div className="right-heading">
        <span>Профиль</span>
        <button className="mobile-close" onClick={onClose} aria-label="Закрыть профиль">
          <X size={17} />
        </button>
      </div>
      <button className="profile-card" onClick={onOpenProfile}>
        <Avatar color="self">{profileAvatar}</Avatar>
        <span>
          <strong>{profileName}</strong>
          <small>
            <i />В сети
          </small>
        </span>
        <ChevronRight size={22} className="yellow-icon" />
      </button>

      <div className="right-divider" />
      {chat.group && (chat.members?.length ?? 0) > 0 && (
        <>
          <div className="online-heading">
            <span>Участники чата</span>
            <b>{chat.members?.length ?? 0}</b>
          </div>
          <div className="friends-list">
            {chat.members?.map((member) => (
              <div key={member} className="friend-row">
                <span className="friend-avatar-wrap">
                  <Avatar color="blue" small>
                    {member.slice(0, 1).toUpperCase()}
                  </Avatar>
                </span>
                <span>{member}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <button className="invite-row" onClick={onCreateInvite}>
        <span>
          <Plus size={22} />
        </span>
        {chat.group ? "Скопировать ссылку-приглашение" : "Приглашение доступно в группах"}
      </button>

      <div className="right-divider games-divider" />
      <button className="games-heading" onClick={onOpenGames}>
        <Gamepad2 size={22} />
        <strong>Мини-игры</strong>
        <ChevronRight size={20} />
      </button>
      <button className="clear-history-button" onClick={onClearHistory}>
        Очистить историю этого чата
      </button>
      <div className="games-list">
        {games.map((game) => (
          <button key={game.name} className="game-row" onClick={() => onOpenGame(game.name)}>
            <span className={`game-icon ${game.cls}`}>{game.icon}</span>
            <span>
              <strong>{game.name}</strong>
              <small>{game.desc}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
