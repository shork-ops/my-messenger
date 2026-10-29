import type { FormEvent } from "react";
import { X } from "lucide-react";
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

