import { useEffect, useRef, useState } from "react";
import {
  BellRing,
  Camera,
  ChevronLeft,
  ChevronRight,
  Database,
  Palette,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { ABOUT_MAX, normalizeAbout, shouldShowAboutCounter } from "../lib/about";
import { avatarFallback } from "../lib/avatar";

/** Sections in the order a person tends to look for them. */
export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Профиль", hint: "Имя, фото, о себе", icon: UserRound },
  { id: "appearance", label: "Оформление", hint: "Тема и размер текста", icon: Palette },
  { id: "privacy", label: "Приватность", hint: "Кто вас видит", icon: ShieldCheck },
  { id: "notifications", label: "Уведомления", hint: "Звук и тихие часы", icon: BellRing },
  { id: "data", label: "Данные", hint: "Хранилище и аккаунт", icon: Database },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export type SettingsModalProps = {
  open: boolean;
  name: string;
  avatar: string;
  avatarPhotoUrl: string | null;
  avatarUploading: boolean;
  username: string;
  about: string;
  usernameSaving: boolean;
  theme: string;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onAvatarChange: (value: string) => void;
  onAvatarFile: (file: File) => void;
  onAvatarRemove: () => void;
  onAboutSave: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onSaveUsername: () => void;
  onThemeChange: (value: string) => void;
  onOpenPrivacy: () => void;
};

/**
 * Account settings.
 *
 * One long form grew until it read as a wall. Sections keep each screen to what
 * fits without scrolling on a phone, and give the later stages somewhere to put
 * their controls instead of appending yet another field to the bottom.
 */
export default function SettingsModal(props: SettingsModalProps) {
  const { open, onClose } = props;
  // On a phone the list and the section are separate screens; on a wide screen
  // both are visible at once.
  const [section, setSection] = useState<SettingsSectionId | null>(null);

  useEffect(() => {
    if (!open) {
      setSection(null);
      return;
    }
    // Narrow screens show one pane; open straight into the profile so the avatar
    // tap lands where it promised. Wide screens show the list and the pane
    // together, so no section needs selecting up front.
    const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
    setSection(narrow ? "profile" : null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (section) setSection(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, section, onClose]);

  if (!open) return null;

  const active = section ?? "profile";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className={`settings-modal settings-shell${section ? " show-detail" : ""}`}
        onClick={(event) => event.stopPropagation()}
        aria-label="Настройки"
      >
        <header>
          <button
            type="button"
            className="settings-back"
            onClick={() => setSection(null)}
            aria-label="Назад к разделам"
          >
            <ChevronLeft size={20} />
          </button>
          <strong>{section ? SETTINGS_SECTIONS.find((s) => s.id === section)?.label : "Настройки"}</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Разделы настроек">
            {SETTINGS_SECTIONS.map(({ id, label, hint, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`settings-nav-item${active === id ? " active" : ""}`}
                aria-current={active === id ? "true" : undefined}
                onClick={() => setSection(id)}
              >
                <Icon size={20} />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
                <ChevronRight size={17} className="settings-chevron" />
              </button>
            ))}
          </nav>

          <div className="settings-detail">
            {active === "profile" && (
              <ProfileSection
                name={props.name}
                avatar={props.avatar}
                avatarPhotoUrl={props.avatarPhotoUrl}
                avatarUploading={props.avatarUploading}
                onAvatarFile={props.onAvatarFile}
                onAvatarRemove={props.onAvatarRemove}
                onAvatarChange={props.onAvatarChange}
                username={props.username}
                usernameSaving={props.usernameSaving}
                onUsernameChange={props.onUsernameChange}
                onSaveUsername={props.onSaveUsername}
                about={props.about}
                onAboutSave={props.onAboutSave}
                onNameChange={props.onNameChange}
              />
            )}
            {active === "appearance" && <AppearanceSection theme={props.theme} onThemeChange={props.onThemeChange} />}
            {active === "privacy" && <PrivacySection onOpenPrivacy={props.onOpenPrivacy} />}
            {active === "notifications" && <NotificationsSection />}
            {active === "data" && <DataSection />}
          </div>
        </div>
      </section>
    </div>
  );
}

type ProfileSectionProps = {
  name: string;
  avatar: string;
  avatarPhotoUrl: string | null;
  avatarUploading: boolean;
  username: string;
  about: string;
  usernameSaving: boolean;
  onNameChange: (value: string) => void;
  onAvatarChange: (value: string) => void;
  onAvatarFile: (file: File) => void;
  onAvatarRemove: () => void;
  onAboutSave: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onSaveUsername: () => void;
};

function ProfileSection({
  name,
  avatar,
  avatarPhotoUrl,
  avatarUploading,
  username,
  about,
  usernameSaving,
  onNameChange,
  onAvatarChange,
  onAvatarFile,
  onAvatarRemove,
  onAboutSave,
  onUsernameChange,
  onSaveUsername,
}: ProfileSectionProps) {
  return (
    <>
      <AvatarEditor
        name={name}
        avatar={avatar}
        photoUrl={avatarPhotoUrl}
        uploading={avatarUploading}
        onFile={onAvatarFile}
        onRemove={onAvatarRemove}
        onLetterChange={onAvatarChange}
      />
      <label>
        Имя
        <input value={name} maxLength={32} onChange={(event) => onNameChange(event.target.value)} />
      </label>
      <label>
        Username — уникальный
        <input
          value={username}
          maxLength={20}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => onUsernameChange(event.target.value.toLowerCase())}
          placeholder="например, alex_2026"
        />
        <small className="modal-help">3–20 символов: латиница, цифры и _. Username должен быть уникальным.</small>
      </label>
      <button type="button" className="save-settings" disabled={usernameSaving} onClick={onSaveUsername}>
        {usernameSaving ? "Сохраняю..." : "Сохранить username"}
      </button>
      <AboutField value={about} onSave={onAboutSave} />
    </>
  );
}

function AppearanceSection({ theme, onThemeChange }: { theme: string; onThemeChange: (value: string) => void }) {
  return (
    <label>
      Цветовая тема
      <select value={theme} onChange={(event) => onThemeChange(event.target.value)}>
        <option value="yellow">Nexus — жёлтая</option>
        <option value="blue">Синяя</option>
        <option value="violet">Фиолетовая</option>
        <option value="mint">Мятная</option>
      </select>
    </label>
  );
}

function PrivacySection({ onOpenPrivacy }: { onOpenPrivacy: () => void }) {
  return (
    <button type="button" className="settings-link" onClick={onOpenPrivacy}>
      <ShieldCheck size={20} />
      <span>
        <strong>Приватность и блокировки</strong>
        <small>Кто вас видит, статусы прочтения, удаление аккаунта</small>
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

function NotificationsSection() {
  return (
    <p className="settings-note">
      Настройки уведомлений появятся здесь. Пока уведомления включаются кнопкой с колокольчиком в левом меню.
    </p>
  );
}

function DataSection() {
  return (
    <p className="settings-note">
      Здесь появятся хранилище, кеш и управление аккаунтом.
    </p>
  );
}

type AvatarEditorProps = {
  name: string;
  avatar: string;
  photoUrl: string | null;
  uploading: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
  onLetterChange: (value: string) => void;
};

/**
 * Photo first, letter second.
 *
 * The letter stays available because it is what shows before a photo is set and
 * for anyone who would rather not upload one.
 */
function AvatarEditor({ name, avatar, photoUrl, uploading, onFile, onRemove, onLetterChange }: AvatarEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="field-block">
      <span className="field-label">Фото профиля</span>
      <div className="avatar-edit">
        <div className="avatar self">
          {photoUrl ? <img className="avatar-photo" src={photoUrl} alt="" /> : avatarFallback(name)}
        </div>
        <div className="avatar-edit-actions">
          <div className="row">
            <button type="button" className="avatar-upload" disabled={uploading} onClick={() => inputRef.current?.click()}>
              <Camera size={17} />
              {uploading ? "Загружаю…" : photoUrl ? "Заменить фото" : "Загрузить фото"}
            </button>
            {photoUrl && (
              <button type="button" className="avatar-remove" disabled={uploading} onClick={onRemove}>
                <Trash2 size={15} /> Убрать
              </button>
            )}
          </div>
          <small className="avatar-hint">JPEG, PNG или WebP до 5 МБ</small>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="visually-hidden"
        aria-label="Выбрать фото профиля"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          // Reset so picking the same file twice still fires a change.
          event.target.value = "";
        }}
      />
      {!photoUrl && (
        <label>
          Буква или эмодзи вместо фото
          <input value={avatar} maxLength={3} onChange={(event) => onLetterChange(event.target.value)} />
        </label>
      )}
    </div>
  );
}

/**
 * Multi-line "about" field.
 *
 * Saved on blur and on the Save button rather than per keystroke: a request per
 * character would race itself and fight anything the user types afterwards.
 */
function AboutField({ value: saved, onSave }: { value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const remaining = ABOUT_MAX - Array.from(draft).length;
  const dirty = normalizeAbout(draft) !== normalizeAbout(saved);
  const hint = shouldShowAboutCounter(draft) ? "Осталось " + remaining + " символов" : "До 140 символов";
  return (
    <label>
      О себе
      <textarea
        className="about-input"
        value={draft}
        rows={2}
        maxLength={ABOUT_MAX + 40}
        placeholder="Коротко о себе — увидят в профиле"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => (dirty ? onSave(draft) : undefined)}
      />
      <small className="modal-help about-help">
        {hint}
        {dirty && (
          <button type="button" className="about-save" onClick={() => onSave(draft)}>
            Сохранить
          </button>
        )}
      </small>
    </label>
  );
}
