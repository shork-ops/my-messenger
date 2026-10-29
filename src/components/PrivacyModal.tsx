import { Ban, ShieldCheck, Trash2, X } from "lucide-react";
import type { PrivacyPreferences } from "../lib/privacy";
import {
  MESSAGE_POLICY,
  PROFILE_VISIBILITY,
  type MessagePolicy,
  type ProfileVisibility,
  type VisibilitySettings,
  describeVisibility,
} from "../lib/visibility";

type PrivacyModalProps = {
  open: boolean;
  preferences: PrivacyPreferences;
  blockedNames: string[];
  saving: boolean;
  deleting: boolean;
  onChange: (next: PrivacyPreferences) => void;
  visibility: VisibilitySettings;
  onVisibilityChange: (next: VisibilitySettings) => void;
  onUnblock: (userId: string) => void;
  onDeleteAccount: () => void;
  onClose: () => void;
};

/**
 * Privacy settings.
 *
 * Each switch is explained in terms of what the other person sees, because
 * "hide last seen" and "disable read receipts" mean little on their own.
 */
export default function PrivacyModal({
  open,
  preferences,
  blockedNames,
  saving,
  deleting,
  onChange,
  visibility,
  onVisibilityChange,
  onUnblock,
  onDeleteAccount,
  onClose,
}: PrivacyModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop privacy-layer" onClick={onClose}>
      <section className="settings-modal privacy-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Приватность</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>

        <label className="privacy-row">
          <span>
            <strong>Скрывать «был(а) в сети»</strong>
            <small>Собеседники увидят «недавно» вместо точного времени</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.hideLastSeen}
            disabled={saving}
            onChange={(event) => onChange({ ...preferences, hideLastSeen: event.target.checked })}
          />
        </label>

        <label className="privacy-row">
          <span>
            <strong>Отключить квитанции о прочтении</strong>
            <small>Ты не будешь видеть отметки о прочтении и сам их не отправляешь</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.disableReadReceipts}
            disabled={saving}
            onChange={(event) => onChange({ ...preferences, disableReadReceipts: event.target.checked })}
          />
        </label>

        {/* Who may find and write is a separate question from what a contact
            can notice, so it sits above the switches rather than among them. */}
        <div className="privacy-section">
          <div className="privacy-heading">
            <ShieldCheck size={15} /> <span>Кто меня видит</span>
          </div>
          <p className="modal-help">{describeVisibility(visibility)}</p>
          <label className="privacy-select">
            <span>Кто может найти меня поиском</span>
            <select
              value={visibility.profile}
              disabled={saving}
              onChange={(event) =>
                onVisibilityChange({ ...visibility, profile: event.target.value as ProfileVisibility })
              }
            >
              {PROFILE_VISIBILITY.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>{PROFILE_VISIBILITY.find((option) => option.id === visibility.profile)?.hint}</small>
          </label>
          <label className="privacy-select">
            <span>Кто может написать первым</span>
            <select
              value={visibility.messages}
              disabled={saving || visibility.profile === "nobody"}
              onChange={(event) =>
                onVisibilityChange({ ...visibility, messages: event.target.value as MessagePolicy })
              }
            >
              {MESSAGE_POLICY.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>
              {visibility.profile === "nobody"
                ? "Пока профиль скрыт, писать могут только те, с кем уже есть чат"
                : MESSAGE_POLICY.find((option) => option.id === visibility.messages)?.hint}
            </small>
          </label>
        </div>

        <div className="privacy-section">
          <div className="privacy-heading">
            <Ban size={15} /> <span>Заблокированные</span>
            <b>{blockedNames.length}</b>
          </div>
          {blockedNames.length === 0 ? (
            <p className="modal-help">Заблокированных нет. Блокировать можно из профиля собеседника.</p>
          ) : (
            <ul className="blocked-list">
              {blockedNames.map((entry) => {
                // Entries are "id:name" so the id survives duplicate names.
                const [id, ...rest] = entry.split(":");
                return (
                  <li key={id}>
                    <span>{rest.join(":") || "Пользователь"}</span>
                    <button type="button" onClick={() => onUnblock(id)} aria-label={`Разблокировать ${rest.join(":")}`}>
                      Разблокировать
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="privacy-section danger-zone">
          <div className="privacy-heading">
            <ShieldCheck size={15} /> <span>Удаление аккаунта</span>
          </div>
          <p className="modal-help">
            Сообщения останутся в чатах обезличенными, профиль, подписки и блокировки удалятся навсегда.
          </p>
          <button type="button" className="danger-button" onClick={onDeleteAccount} disabled={deleting}>
            <Trash2 size={14} /> {deleting ? "Удаляю…" : "Удалить аккаунт"}
          </button>
        </div>
      </section>
    </div>
  );
}
