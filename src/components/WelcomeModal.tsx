import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Camera, X } from "lucide-react";
import { avatarFallback } from "../lib/avatar";
import "../styles/welcome.css";

const TOO_SHORT = "Минимум 3 символа";

/** What is wrong with a username as typed, or null when it is empty or fine. */
export function usernameProblem(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (/[^a-z0-9_]/.test(normalized)) return "Только латинские буквы, цифры и _";
  if (normalized.length < 3) return TOO_SHORT;
  return null;
}

type WelcomeModalProps = {
  name: string;
  username: string;
  photoUrl: string | null;
  uploading: boolean;
  saving: boolean;
  onNameChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onPhoto: (file: File) => void;
  /** Resolves to whether the username was stored; the reason for a failure is shown as a notice. */
  onSaveUsername: () => Promise<boolean>;
  /** Called on "Готово" and on "Позже": either way the card is not shown again. */
  onFinish: () => void;
};

/**
 * The first screen of a new account: a name people see, an @username people can find, and a photo.
 *
 * Only the username needs the server's word, because it must be unique; the name saves as it is
 * typed and the photo uploads as soon as it is picked, the same as in Settings. Nothing is
 * required - "Позже" closes the card, and every field is still in Settings afterwards.
 */
export default function WelcomeModal({
  name,
  username,
  photoUrl,
  uploading,
  saving,
  onNameChange,
  onUsernameChange,
  onPhoto,
  onSaveUsername,
  onFinish,
}: WelcomeModalProps) {
  const titleId = useId();
  const hintId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  // "Too short" waits for "Готово": it is true of every username while it is being typed.
  const [tried, setTried] = useState(false);
  const problem = usernameProblem(username);
  const shownProblem = problem && (tried || problem !== TOO_SHORT) ? problem : null;

  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setTried(true);
    if (username.trim()) {
      if (problem) return;
      if (!(await onSaveUsername())) return;
    }
    onFinish();
  }

  return (
    <div className="modal-backdrop">
      <form className="settings-modal welcome-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => void submit(event)}>
        <header>
          <strong id={titleId}>Добро пожаловать в Nexus</strong>
          <button type="button" onClick={onFinish} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <p className="modal-help">Расскажи, как тебя зовут, — и можно писать. Всё это потом меняется в настройках.</p>
        <div className="avatar-edit">
          <div className="avatar self">{photoUrl ? <img className="avatar-photo" src={photoUrl} alt="" /> : avatarFallback(name)}</div>
          <div className="avatar-edit-actions">
            <button type="button" className="avatar-upload" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Camera size={17} />
              {uploading ? "Загружаю…" : photoUrl ? "Заменить фото" : "Добавить фото"}
            </button>
            <small className="avatar-hint">Необязательно. JPEG, PNG или WebP до 5 МБ</small>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="visually-hidden"
          aria-label="Выбрать фото профиля"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPhoto(file);
            // Reset so picking the same file twice still fires a change.
            event.target.value = "";
          }}
        />
        <label>
          Имя
          <input autoFocus value={name} maxLength={32} autoComplete="name" onChange={(event) => onNameChange(event.target.value)} />
          <small className="modal-help">Его видят собеседники.</small>
        </label>
        <label>
          Имя пользователя (@username)
          <input
            value={username}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={shownProblem ? true : undefined}
            aria-describedby={hintId}
            onChange={(event) => onUsernameChange(event.target.value.toLowerCase())}
            placeholder="например, alex_2026"
          />
          <small id={hintId} className={shownProblem ? "modal-help welcome-error" : "modal-help"} role={shownProblem ? "alert" : undefined}>
            {shownProblem ?? "3–20 символов: латиница, цифры и _. По нему тебя найдут через поиск."}
          </small>
        </label>
        <div className="welcome-actions">
          <button type="button" className="welcome-later" onClick={onFinish}>
            Позже
          </button>
          <button type="submit" className="save-settings" disabled={saving}>
            {saving ? "Сохраняю..." : "Готово"}
          </button>
        </div>
      </form>
    </div>
  );
}
