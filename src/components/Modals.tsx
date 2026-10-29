import type { FormEvent } from "react";
import { useRef } from "react";
import { Camera, ChevronRight, ShieldCheck, Trash2, X } from "lucide-react";
import { avatarFallback } from "../lib/avatar";
import type { Message } from "../types";

type NewChatModalProps = {
  open: boolean;
  groupOnly: boolean;
  name: string;
  isGroup: boolean;
  onNameChange: (value: string) => void;
  onIsGroupChange: (value: boolean) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
};

export function NewChatModal({ open, groupOnly, name, isGroup, onNameChange, onIsGroupChange, onClose, onSubmit }: NewChatModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="settings-modal" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>{groupOnly ? "Новая группа" : "Новый чат"}</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <p className="modal-help">
          {groupOnly
            ? "Создай облачную группу. Участники смогут вступить по ссылке-приглашению."
            : "Создай локальный чат или облачную группу. Для группового чата участники смогут вступить по ссылке-приглашению."}
        </p>
        <label>
          Имя чата
          <input autoFocus value={name} maxLength={48} onChange={(event) => onNameChange(event.target.value)} placeholder="Например, Команда" required />
        </label>
        {!groupOnly && (
          <label className="group-toggle">
            <input type="checkbox" checked={isGroup} onChange={(event) => onIsGroupChange(event.target.checked)} /> Создать группу
          </label>
        )}
        <button type="submit" className="save-settings">
          Создать
        </button>
      </form>
    </div>
  );
}

type PollModalProps = {
  open: boolean;
  question: string;
  options: string[];
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onQuestionChange: (value: string) => void;
  onOptionChange: (index: number, value: string) => void;
  onAddOption: () => void;
};

export function PollModal({ open, question, options, onClose, onSubmit, onQuestionChange, onOptionChange, onAddOption }: PollModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="settings-modal" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Новый опрос</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <label>
          Вопрос
          <input autoFocus value={question} maxLength={180} onChange={(event) => onQuestionChange(event.target.value)} placeholder="Что выбираем?" required />
        </label>
        {options.map((option, index) => (
          <label key={index}>
            Вариант {index + 1}
            <input value={option} maxLength={80} onChange={(event) => onOptionChange(index, event.target.value)} placeholder={`Вариант ${index + 1}`} />
          </label>
        ))}
        {options.length < 6 && (
          <button type="button" className="game-secondary" onClick={onAddOption}>
            + Добавить вариант
          </button>
        )}
        <button type="submit" className="save-settings">
          Опубликовать опрос
        </button>
      </form>
    </div>
  );
}

type GalleryModalProps = {
  open: boolean;
  images: (Message & { chatName: string })[];
  onClose: () => void;
  onOpenImage: (image: Message & { chatName: string }) => void;
};

export function GalleryModal({ open, images, onClose, onOpenImage }: GalleryModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="settings-modal gallery-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Галерея медиа</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <p className="modal-help">Изображения из всех локальных чатов</p>
        {images.length ? (
          <div className="media-gallery">
            {images.map((image) => (
              <button
                type="button"
                key={`${image.id}-${image.chatName}`}
                onClick={() => onOpenImage(image)}
                title={`${image.chatName} · ${image.attachment?.name}`}
              >
                <img src={image.attachment!.data} alt={image.attachment!.name} />
                <small>{image.chatName}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-search">Пока нет изображений. Прикрепи картинку к сообщению.</div>
        )}
      </section>
    </div>
  );
}

type ProfileModalProps = {
  open: boolean;
  name: string;
  avatar: string;
  /** Signed URL of the uploaded photo, null when the letter is in use. */
  avatarPhotoUrl: string | null;
  avatarUploading: boolean;
  onAvatarFile: (file: File) => void;
  onAvatarRemove: () => void;
  username: string;
  usernameSaving: boolean;
  theme: string;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onAvatarChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onSaveUsername: () => void;
  onThemeChange: (value: string) => void;
  /** Opens the privacy settings on top of this dialog. */
  onOpenPrivacy: () => void;
  onDone: () => void;
};

export function ProfileModal({
  open,
  name,
  avatar,
  avatarPhotoUrl,
  avatarUploading,
  onAvatarFile,
  onAvatarRemove,
  username,
  usernameSaving,
  theme,
  onClose,
  onNameChange,
  onAvatarChange,
  onUsernameChange,
  onSaveUsername,
  onThemeChange,
  onOpenPrivacy,
  onDone,
}: ProfileModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Профиль и оформление</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
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
          Цветовая тема
          <select value={theme} onChange={(event) => onThemeChange(event.target.value)}>
            <option value="yellow">Nexus — жёлтая</option>
            <option value="blue">Синяя</option>
            <option value="violet">Фиолетовая</option>
            <option value="mint">Мятная</option>
          </select>
        </label>
        <div className="settings-divider" />
        <button type="button" className="settings-link" onClick={onOpenPrivacy}>
          <ShieldCheck size={20} />
          <span>
            <strong>Приватность и блокировки</strong>
            <small>Кто вас видит, статусы прочтения, удаление аккаунта</small>
          </span>
          <ChevronRight size={18} />
        </button>

        <button type="button" className="save-settings" onClick={onDone}>
          Готово
        </button>
      </section>
    </div>
  );

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
}
