import { badgeText } from "../lib/notifications";
import type { Dictionary } from "../lib/i18n";
import { Bell, Gamepad2, MessageCircle, Settings } from "lucide-react";
import Avatar from "./Avatar";

type RailProps = {
  activeNav: string;
  profileName: string;
  profileAvatar: string;
  /** Signed URL of the profile photo, null when no photo is set. */
  selfAvatarUrl?: string | null;
  unreadTotal: number;
  notificationsGranted: boolean;
  onNavigate: (label: string) => void;
  onOpenSettings: () => void;
  onOpenGames: () => void;
  onOpenProfile: () => void;
  onToggleNotifications: () => void;
  /** The Russian strings are the source, so the caller passes them with the keys. */
  t: (key: string, ru?: Dictionary) => string;
};

export default function Rail({
  activeNav,
  profileName,
  profileAvatar,
  selfAvatarUrl,
  unreadTotal,
  notificationsGranted,
  onNavigate,
  onOpenSettings,
  onOpenGames,
  onOpenProfile,
  onToggleNotifications,
  t,
}: RailProps) {
  return (
    <aside className="rail">
      <button className="brand" onClick={() => onNavigate("Чаты")} aria-label="Nexus — главная">
        <span className="brand-mark">M</span>
        <span className="brand-name">Nexus</span>
      </button>

      <nav className="main-nav">
        <button
          className={`nav-link ${activeNav === "Чаты" ? "active" : ""}`}
          onClick={() => onNavigate("Чаты")}
          aria-label={t("nav.chats", { "nav.chats": "Чаты" })}
        >
          <MessageCircle size={22} />
          <span>{t("nav.chats", { "nav.chats": "Чаты" })}</span>
          {unreadTotal > 0 && (
            <b className="nav-count" title={`${unreadTotal} непрочитанных`}>
              {badgeText(unreadTotal)}
            </b>
          )}
        </button>
        <button
          className={`nav-link ${activeNav === "Мини-игры" ? "active" : ""}`}
          onClick={onOpenGames}
          aria-label={t("nav.games", { "nav.games": "Мини-игры" })}
        >
          <Gamepad2 size={22} />
          <span>{t("nav.games", { "nav.games": "Мини-игры" })}</span>
        </button>
        <button
          className={`nav-link ${notificationsGranted ? "notifications-on" : ""}`}
          onClick={onToggleNotifications}
          title={notificationsGranted ? "Уведомления включены" : "Включить уведомления"}
          aria-label={notificationsGranted ? "Уведомления включены" : "Включить уведомления"}
        >
          <Bell size={22} />
          <span>{t("nav.notifications", { "nav.notifications": "Уведомления" })}</span>
        </button>
        <div className="nav-divider" />
        <button
          className={`nav-link ${activeNav === "Настройки" ? "active" : ""}`}
          onClick={onOpenSettings}
          aria-label={t("nav.settings", { "nav.settings": "Настройки" })}
        >
          <Settings size={22} />
          <span>{t("nav.settings", { "nav.settings": "Настройки" })}</span>
        </button>
      </nav>

      <button className="self-profile" onClick={onOpenProfile}>
        <Avatar color="self" src={selfAvatarUrl}>{profileAvatar}</Avatar>
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
