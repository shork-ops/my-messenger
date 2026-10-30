import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, MutableRefObject } from "react";
import { CheckCheck, Clock, Image, Mic, Paperclip, Plus, Send, Smile, Sticker, Users, Video, X } from "lucide-react";
import type { Message } from "../types";

type ComposerProps = {
  draft: string;
  editDraft: string;
  editing: boolean;
  replyTarget: Message | null;
  mentionOpen: boolean;
  mentionMatches: string[];
  recording: boolean;
  recordingSeconds: number;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  onChangeText: (value: string) => void;
  onEmoji: () => void;
  onStickers: () => void;
  onVideoNote: () => void;
  onToggleVoice: () => void;
  onSubmit: (event: FormEvent) => void;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onChooseMention: (name: string) => void;
  onAttachment: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenGallery: () => void;
  onOpenPoll: () => void;
  /** Offers the moments to send at, when the draft is ready. */
  onSchedule: () => void;
};

export default function Composer({
  draft,
  editDraft,
  editing,
  replyTarget,
  mentionOpen,
  mentionMatches,
  recording,
  recordingSeconds,
  fileInputRef,
  onChangeText,
  onEmoji,
  onStickers,
  onVideoNote,
  onToggleVoice,
  onSubmit,
  onCancelEdit,
  onCancelReply,
  onChooseMention,
  onAttachment,
  onOpenGallery,
  onOpenPoll,
  onSchedule,
}: ComposerProps) {
  const value = editing ? editDraft : draft;
  const [attachOpen, setAttachOpen] = useState(false);
  const attachRef = useRef<HTMLDivElement | null>(null);

  // Close the attachment menu on an outside click or Escape, like any popover.
  useEffect(() => {
    if (!attachOpen) return;
    function onDown(event: MouseEvent) {
      if (!attachRef.current?.contains(event.target as Node)) setAttachOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setAttachOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [attachOpen]);

  function runFromMenu(action: () => void) {
    setAttachOpen(false);
    action();
  }

  return (
    <>
      {editing && (
        <div className="edit-banner">
          Редактирование сообщения{" "}
          <button type="button" onClick={onCancelEdit} aria-label="Отменить редактирование">
            <X size={15} />
          </button>
        </div>
      )}
      {replyTarget && (
        <div className="reply-banner">
          <span>
            <strong>Ответ для {replyTarget.author}</strong>
            <small>{replyTarget.text}</small>
          </span>
          <button type="button" onClick={onCancelReply} aria-label="Отменить ответ">
            <X size={15} />
          </button>
        </div>
      )}
      <form className="composer" onSubmit={onSubmit}>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden-file-input"
          accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx,.zip,.csv"
          aria-label="Прикрепить файл"
          onChange={onAttachment}
        />
        <div className="attach-menu-wrap" ref={attachRef}>
          <button
            type="button"
            className={`attach-button ${attachOpen ? "open" : ""}`}
            onClick={() => setAttachOpen((open) => !open)}
            aria-label="Прикрепить"
            aria-expanded={attachOpen}
            title="Прикрепить"
          >
            <Plus size={22} />
          </button>
          {attachOpen && (
            <div className="attach-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => runFromMenu(onOpenGallery)}>
                <Image size={18} /> Галерея
              </button>
              <button type="button" role="menuitem" onClick={() => runFromMenu(() => fileInputRef.current?.click())}>
                <Paperclip size={18} /> Файл
              </button>
              <button type="button" role="menuitem" onClick={() => runFromMenu(onOpenPoll)}>
                <Users size={18} /> Опрос
              </button>
              {/* Scheduling needs something to send; offering it on an empty input would
                  open a menu that can only be cancelled. */}
              <button
                type="button"
                role="menuitem"
                onClick={() => runFromMenu(onSchedule)}
                disabled={value.trim() === ""}
              >
                <Clock size={18} /> Отправить позже
              </button>
            </div>
          )}
        </div>
        <div className="composer-input-wrap">
          <input
            value={value}
            onChange={(event) => onChangeText(event.target.value)}
            placeholder={editing ? "Изменить сообщение..." : "Написать сообщение..."}
            aria-label="Текст сообщения"
          />
          {mentionOpen && mentionMatches.length > 0 && (
            <div className="mention-suggestions">
              {mentionMatches.map((name) => (
                <button type="button" key={name} onClick={() => onChooseMention(name)}>
                  @{name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="emoji-button" onClick={onEmoji} aria-label="Добавить эмодзи">
          <Smile size={20} />
        </button>
        <button type="button" className="emoji-button sticker-button" onClick={onStickers} aria-label="Стикеры" title="Стикеры">
          <Sticker size={20} />
        </button>
        <button type="button" className="attach-button note-button" onClick={onVideoNote} aria-label="Записать видеозаметку" title="Видеозаметка">
          <Video size={20} />
        </button>
        <button
          type="button"
          className={`attach-button voice-button ${recording ? "recording" : ""}`}
          onClick={onToggleVoice}
          aria-label={recording ? "Остановить запись" : "Записать голосовое"}
          title={recording ? `Остановить запись · ${recordingSeconds} сек.` : "Голосовое сообщение"}
        >
          <Mic size={20} />
          {recording && <span>{recordingSeconds}s</span>}
        </button>
        <button
          type="submit"
          className="send-button"
          aria-label={editing ? "Сохранить изменения" : "Отправить сообщение"}
          disabled={!value.trim()}
        >
          {editing ? <CheckCheck size={20} /> : <Send size={20} />}
        </button>
      </form>
    </>
  );
}
