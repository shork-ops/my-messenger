import { Gamepad2, MessageCircle, Phone, Settings, Video } from "lucide-react";
import Avatar from "./Avatar";

type RailProps = {
  activeNav: string;
  profileName: string;
  profileAvatar: string;
  unreadTotal: number;
  onNavigate: (label: string) => void;
  onOpenSettings: () => void;
  onOpenGames: () => void;
  onOpenProfile: () => void;
};

export default function Rail({
  activeNav,
  profileName,
  profileAvatar,
  unreadTotal,
  onNavigate,
  onOpenSettings,
  onOpenGames,
  onOpenProfile,
}: RailProps) {
  return (
    <aside className="rail">
      <button className="brand" onClick={() => onNavigate("Чаты")} aria-label="Nexus — главная">
        <span className="brand-mark">M</span>
        <span className="brand-name">Nexus</span>
      </button>

      <nav className="main-nav">
        <button className={`nav-link ${activeNav === "Чаты" ? "active" : ""}`} onClick={() => onNavigate("Чаты")}>
          <MessageCircle size={22} />
          <span>Чаты</span>
          {unreadTotal > 0 && <b className="nav-count">{unreadTotal}</b>}
        </button>
        <button className={`nav-link ${activeNav === "Звонки" ? "active" : ""}`} onClick={() => onNavigate("Звонки")}>
          <Phone size={22} />
          <span>Звонки</span>
        </button>
        <button className={`nav-link ${activeNav === "Видео" ? "active" : ""}`} onClick={() => onNavigate("Видео")}>
          <Video size={22} />
          <span>Видео</span>
        </button>
        <button className={`nav-link ${activeNav === "Мини-игры" ? "active" : ""}`} onClick={onOpenGames}>
          <Gamepad2 size={22} />
          <span>Мини-игры</span>
        </button>
        <div className="nav-divider" />
        <button className={`nav-link ${activeNav === "Настройки" ? "active" : ""}`} onClick={onOpenSettings}>
          <Settings size={22} />
          <span>Настройки</span>
        </button>
      </nav>

      <button className="self-profile" onClick={onOpenProfile}>
        <Avatar color="self">{profileAvatar}</Avatar>
        <span className="self-copy">
          <strong>{profileName}</strong>
          <small>
            <i />В сети
          </small>
        </span>
        <Settings size={18} className="self-settings" />
      </button>
    </aside>
  );
}
