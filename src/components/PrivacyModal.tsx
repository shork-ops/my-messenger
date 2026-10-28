import { Ban, ShieldCheck, Trash2, X } from "lucide-react";
import type { PrivacyPreferences } from "../lib/privacy";

type PrivacyModalProps = {
  open: boolean;
  preferences: PrivacyPreferences;
  blockedNames: string[];
  saving: boolean;
  deleting: boolean;
  onChange: (next: PrivacyPreferences) => void;
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
  onUnblock,
  onDeleteAccount,
  onClose,
}: PrivacyModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
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
