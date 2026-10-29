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
import { TEXT_SIZES } from "../lib/textSize";
import { formatMinute, parseMinute, type NotificationPrefs } from "../lib/notificationPrefs";
import { plural, storageSummary } from "../lib/storageUsage";
import { LANGUAGES, type Language } from "../lib/i18n";
import { type SessionRecord, lastSeenLabel } from "../lib/sessions";
import { avatarFallback } from "../lib/avatar";
import TwoFactorPanel from "./TwoFactorPanel";
import { WALLPAPERS, type WallpaperId, wallpaperBackground, wallpaperSize } from "../lib/wallpaper";
import { MEDIA_POLICIES, type MediaPolicy } from "../lib/mediaPolicy";

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
  textSize: string;
  onTextSizeChange: (value: string) => void;
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
  prefs: NotificationPrefs;
  onPrefsChange: (next: NotificationPrefs) => void;
  /** Current permission state, shown so a blocked browser is not a mystery. */
  permission: NotificationPermission | "unsupported";
  onRequestPermission: () => void;
  mediaBytes: number;
  attachmentCount: number;
  cacheKeys: string[];
  onClearCache: () => void;
  clearing: boolean;
  language: Language;
  onLanguageChange: (value: Language) => void;
  wallpaper: WallpaperId;
  onWallpaperChange: (value: WallpaperId) => void;
  devices: SessionRecord[];
  currentDeviceId: string;
  onSignOutOthers: () => void;
  signingOut: boolean;
  passcode: string | null;
  onPasscodeChange: (code: string | null) => void;
  twoFactor: TwoFactorState;
  mediaPolicy: MediaPolicy;
  onMediaPolicyChange: (value: MediaPolicy) => void;
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
            {active === "appearance" && (
              <AppearanceSection
                theme={props.theme}
                onThemeChange={props.onThemeChange}
                textSize={props.textSize}
                onTextSizeChange={props.onTextSizeChange}
                language={props.language}
                onLanguageChange={props.onLanguageChange}
                wallpaper={props.wallpaper}
                onWallpaperChange={props.onWallpaperChange}
              />
            )}
            {active === "privacy" && <PrivacySection onOpenPrivacy={props.onOpenPrivacy} />}
            {active === "notifications" && (
              <NotificationsSection
                prefs={props.prefs}
                onPrefsChange={props.onPrefsChange}
                permission={props.permission}
                onRequestPermission={props.onRequestPermission}
              />
            )}
            {active === "data" && (
        <DataSection
          mediaBytes={props.mediaBytes}
          attachmentCount={props.attachmentCount}
          cacheKeys={props.cacheKeys}
          onClearCache={props.onClearCache}
          clearing={props.clearing}
          devices={props.devices}
          currentDeviceId={props.currentDeviceId}
          onSignOutOthers={props.onSignOutOthers}
          signingOut={props.signingOut}
          passcode={props.passcode}
          onPasscodeChange={props.onPasscodeChange}
          twoFactor={props.twoFactor}
          mediaPolicy={props.mediaPolicy}
          onMediaPolicyChange={props.onMediaPolicyChange}
        />
      )}
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

function AppearanceSection({
  theme,
  onThemeChange,
  textSize,
  onTextSizeChange,
  language,
  onLanguageChange,
  wallpaper,
  onWallpaperChange,
}: {
  theme: string;
  onThemeChange: (value: string) => void;
  textSize: string;
  onTextSizeChange: (value: string) => void;
  language: Language;
  onLanguageChange: (value: Language) => void;
  wallpaper: WallpaperId;
  onWallpaperChange: (value: WallpaperId) => void;
}) {
  return (
    <>
      <label>
        Цветовая тема
        <select value={theme} onChange={(event) => onThemeChange(event.target.value)}>
          <option value="yellow">Nexus — жёлтая</option>
          <option value="blue">Синяя</option>
          <option value="violet">Фиолетовая</option>
          <option value="mint">Мятная</option>
          <option value="light">Светлая</option>
        </select>
      </label>
      <div className="field-block">
        <span className="field-label">Размер текста</span>
        <div className="text-size-row" role="group" aria-label="Размер текста">
          {TEXT_SIZES.map((size) => (
            <button
              key={size.id}
              type="button"
              className={`text-size-option${textSize === size.id ? " active" : ""}`}
              aria-pressed={textSize === size.id}
              onClick={() => onTextSizeChange(size.id)}
            >
              <span style={{ fontSize: `${Math.round(15 * size.scale)}px` }}>Аа</span>
              {size.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field-block">
        <span className="field-label">Обои чата</span>
        <div className="wallpaper-row" role="group" aria-label="Обои чата">
          {WALLPAPERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`wallpaper-option${wallpaper === item.id ? " active" : ""}`}
              aria-pressed={wallpaper === item.id}
              onClick={() => onWallpaperChange(item.id)}
            >
              {/* The swatch is the pattern itself, so the choice needs no words. */}
              <span
                className="wallpaper-swatch"
                style={{
                backgroundImage: wallpaperBackground(item.id, "currentColor"),
                backgroundSize: wallpaperSize(item.id),
              }}
                aria-hidden="true"
              />
              {item.label}
            </button>
          ))}
        </div>
        <small className="settings-hint">{WALLPAPERS.find((item) => item.id === wallpaper)?.hint}</small>
      </div>

      <label>
        Язык интерфейса
        <select value={language} onChange={(event) => onLanguageChange(event.target.value as Language)}>
          {LANGUAGES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </>
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

function NotificationsSection({
  prefs,
  onPrefsChange,
  permission,
  onRequestPermission,
}: {
  prefs: NotificationPrefs;
  onPrefsChange: (next: NotificationPrefs) => void;
  permission: NotificationPermission | "unsupported";
  onRequestPermission: () => void;
}) {
  const permissionText =
    permission === "granted"
      ? "Разрешены"
      : permission === "denied"
        ? "Запрещены в настройках браузера"
        : permission === "unsupported"
          ? "Браузер не поддерживает"
          : "Не запрошены";

  const setQuiet = (patch: Partial<NotificationPrefs["quiet"]>) =>
    onPrefsChange({ ...prefs, quiet: { ...prefs.quiet, ...patch } });

  return (
    <>
      <div className="settings-row">
        <span>
          <strong>Системные уведомления</strong>
          <small>{permissionText}</small>
        </span>
        {permission === "default" && (
          <button type="button" className="settings-action" onClick={onRequestPermission}>
            Разрешить
          </button>
        )}
      </div>

      <ToggleRow
        label="Звук"
        hint="Короткий сигнал при новом сообщении"
        checked={prefs.sound}
        onChange={(checked) => onPrefsChange({ ...prefs, sound: checked })}
      />
      <ToggleRow
        label="Вибрация"
        hint="На телефоне — при новом сообщении"
        checked={prefs.vibration}
        onChange={(checked) => onPrefsChange({ ...prefs, vibration: checked })}
      />

      <div className="settings-divider" />

      <ToggleRow
        label="Тихие часы"
        hint="Сообщения приходят, но без звука и вибрации"
        checked={prefs.quiet.enabled}
        onChange={(checked) => setQuiet({ enabled: checked })}
      />
      {prefs.quiet.enabled && (
        <div className="quiet-row">
          <label>
            С
            <input
              type="time"
              value={formatMinute(prefs.quiet.fromMinute)}
              onChange={(event) => {
                const minute = parseMinute(event.target.value);
                if (minute !== null) setQuiet({ fromMinute: minute });
              }}
            />
          </label>
          <label>
            До
            <input
              type="time"
              value={formatMinute(prefs.quiet.toMinute)}
              onChange={(event) => {
                const minute = parseMinute(event.target.value);
                if (minute !== null) setQuiet({ toMinute: minute });
              }}
            />
          </label>
        </div>
      )}
    </>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-row toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i className="toggle-track" aria-hidden="true" />
    </label>
  );
}

/** The 2FA callbacks, bundled so three layers do not each list eight props. */
type TwoFactorState = {
  status: "verified" | "unverified" | null;
  pending: { uri: string; secret: string } | null;
  busy: boolean;
  error: string | null;
  start: () => void;
  confirm: (code: string) => void;
  cancel: () => void;
  disable: () => void;
};

type DataSectionProps = {
  /** Bytes of attachments this account has, and how many messages carry them. */
  mediaBytes: number;
  attachmentCount: number;
  /** Keys currently present in this browser's storage. */
  cacheKeys: string[];
  onClearCache: () => void;
  clearing: boolean;
  /** Devices this account has been used on, most recent first. */
  devices: SessionRecord[];
  currentDeviceId: string;
  onSignOutOthers: () => void;
  signingOut: boolean;
  passcode: string | null;
  onPasscodeChange: (code: string | null) => void;
  twoFactor: TwoFactorState;
  mediaPolicy: MediaPolicy;
  onMediaPolicyChange: (value: MediaPolicy) => void;
};

/**
 * The two numbers are shown apart on purpose.
 *
 * Cache is free to throw away. Attachments are not: they cost bandwidth to fetch
 * again, so folding them into one "1.2 ГБ" would invite people to clear the wrong
 * thing.
 */
function DataSection({
  mediaBytes,
  attachmentCount,
  cacheKeys,
  onClearCache,
  clearing,
  devices,
  currentDeviceId,
  onSignOutOthers,
  signingOut,
  passcode,
  onPasscodeChange,
  twoFactor,
  mediaPolicy,
  onMediaPolicyChange,
}: DataSectionProps) {
  const now = Date.now();
  const [codeDraft, setCodeDraft] = useState("");
  return (
    <>
      <p className="settings-note">Вложения в этом аккаунте. Хранятся в облаке, не на устройстве.</p>
      <div className="settings-row">
        <span>
          <strong>Вложения</strong>
          <small>{storageSummary(mediaBytes, attachmentCount)}</small>
        </span>
      </div>
      <div className="settings-row">
        <span>
          <strong>Кеш браузера</strong>
          <small>
            {cacheKeys.length === 0
              ? "Пусто"
              : `${cacheKeys.length} ${plural(cacheKeys.length, "настройка", "настройки", "настроек")} на этом устройстве`}
          </small>
        </span>
        <button type="button" className="settings-action" disabled={clearing || cacheKeys.length === 0} onClick={onClearCache}>
          {clearing ? "Очищаю…" : "Очистить"}
        </button>
      </div>
      <p className="settings-note">
        Очистка сбрасывает тему, размер текста, настройки уведомлений и язык. Сообщения и вложения останутся — они в облаке.
      </p>

      <div className="settings-divider" />
      <div className="field-block">
        <span className="field-label">Загрузка фото и видео</span>
        <select
          value={mediaPolicy}
          aria-label="Загрузка фото и видео"
          onChange={(event) => onMediaPolicyChange(event.target.value as MediaPolicy)}
        >
          {MEDIA_POLICIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <small className="settings-hint">{MEDIA_POLICIES.find((option) => option.id === mediaPolicy)?.hint}</small>
      </div>

      <div className="settings-divider" />
      <p className="settings-note">Двухфакторная аутентификация</p>
      <TwoFactorPanel
        status={twoFactor.status}
        pending={twoFactor.pending}
        busy={twoFactor.busy}
        error={twoFactor.error}
        onStart={twoFactor.start}
        onSubmitCode={twoFactor.confirm}
        onCancel={twoFactor.cancel}
        onDisable={twoFactor.disable}
      />

      <div className="settings-divider" />
      <div className="settings-row">
        <span>
          <strong>Устройства</strong>
          <small>
            {devices.length === 1
              ? "Только это устройство"
              : `${devices.length} ${plural(devices.length, "устройство", "устройства", "устройств")}`}
          </small>
        </span>
        {devices.length > 1 && (
          <button type="button" className="settings-action danger" disabled={signingOut} onClick={onSignOutOthers}>
            {signingOut ? "Выхожу…" : "Выйти на других"}
          </button>
        )}
      </div>
      <div className="settings-row">
        <span>
          <strong>Код доступа</strong>
          <small>
            {passcode
              ? "Приложение спрашивает код при запуске"
              : "Замок на приложение. Защищает от чужого взгляда, но не заменяет пароль аккаунта."}
          </small>
        </span>
        {passcode ? (
          <button type="button" className="settings-action" onClick={() => onPasscodeChange(null)}>
            Убрать код
          </button>
        ) : (
          <div className="passcode-setter">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="4 цифры"
              aria-label="Новый код доступа"
              value={codeDraft}
              onChange={(event) => setCodeDraft(event.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            <button
              type="button"
              className="settings-action"
              disabled={!/^\d{4}$/.test(codeDraft)}
              onClick={() => {
                onPasscodeChange(codeDraft);
                setCodeDraft("");
              }}
            >
              Включить
            </button>
          </div>
        )}
      </div>

      <ul className="device-list">
        {devices.map((device) => (
          <li key={device.deviceId}>
            <span>
              <strong>
                {device.label} · {device.platform}
              </strong>
              <small>{lastSeenLabel(device.lastSeen, now)}</small>
            </span>
            {device.deviceId === currentDeviceId && <b className="device-current">это устройство</b>}
          </li>
        ))}
      </ul>
    </>
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
