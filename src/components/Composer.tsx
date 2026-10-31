import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, MutableRefObject } from "react";
import { CheckCheck, Clock, EyeOff, Image, Mic, Paperclip, Plus, Send, Smile, Sticker, Users, Video, X, Gamepad2 } from "lucide-react";
import type { Message } from "../types";
import { SUPPORTED_TYPES } from "../lib/media";

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
  /** Puts a game invitation into the draft, so it is sent like any other message. */
  onGameInvite: (kind: "chess" | "cards" | "balda") => void;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onChooseMention: (name: string) => void;
  onAttachment: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenGallery: () => void;
  onOpenPoll: () => void;
  /** Offers the moments to send at, when the draft is ready. */
  onSchedule: () => void;
  /** Picks a photo to be looked at once, rather than to be sent as an ordinary picture. */
  onViewOnce: () => void;
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
  onGameInvite,
  onCancelEdit,
  onCancelReply,
  onChooseMention,
  onAttachment,
  onOpenGallery,
  onOpenPoll,
  onSchedule,
  onViewOnce,
}: ComposerProps) {
  const value = editing ? editDraft : draft;
  const [attachOpen, setAttachOpen] = useState(false);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [expressionOpen, setExpressionOpen] = useState(false);
  const expressionRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "auto";
      const maxHeight = parseFloat(getComputedStyle(input).lineHeight) * 5 + 24;
      input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
      input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(input.parentElement!);
    return () => observer.disconnect();
  }, [value]);

  useEffect(() => {
    if (!expressionOpen) return;
    const close = (event: MouseEvent) => {
      if (!expressionRef.current?.contains(event.target as Node)) setExpressionOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpressionOpen(false);
        expressionRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [expressionOpen]);
  const attachRef = useRef<HTMLDivElement | null>(null);

  // Close the attachment menu on an outside click or Escape, like any popover.
  useEffect(() => {
    if (!attachOpen) return;
    function onDown(event: MouseEvent) {
      if (!attachRef.current?.contains(event.target as Node)) setAttachOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAttachOpen(false);
        attachRef.current?.querySelector("button")?.focus();
      }
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
          multiple
          accept={SUPPORTED_TYPES.join(",")}
          aria-label="Прикрепить файл"
          onChange={onAttachment}
        />
        <div className="attach-menu-wrap" ref={attachRef}>
          <button
            type="button"
            className={`attach-button ${attachOpen ? "open" : ""}`}
            onClick={() => { setExpressionOpen(false); setAttachOpen((open) => !open); }}
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
              <button type="button" role="menuitem" aria-label="Записать видеозаметку" onClick={() => runFromMenu(onVideoNote)}>
                <Video size={18} /> Видеозаметка
              </button>
              {/* Scheduling needs something to send; offering it on an empty input would
                  open a menu that can only be cancelled. */}
              <button type="button" role="menuitem" onClick={() => runFromMenu(onViewOnce)}>
                <EyeOff size={18} /> Посмотреть один раз
              </button>
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
          <textarea
            ref={inputRef}
            rows={1}
            enterKeyHint="enter"
            value={value}
            onKeyDown={(event) => {
              // Phone keyboards keep Return for a new line; sending stays an explicit tap.
              if (window.matchMedia("(max-width: 760px)").matches) return;
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                if (value.trim()) event.currentTarget.form?.requestSubmit();
              }
            }}
            title="На компьютере: Enter — отправить, Shift+Enter — новая строка"
            onChange={(event) => onChangeText(event.target.value)}
            placeholder={editing ? "Изменить…" : "Текст…"}
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
        <div className="attach-menu-wrap expression-menu-wrap" ref={expressionRef}>
          <button type="button" className="emoji-button" onClick={() => { setAttachOpen(false); setExpressionOpen((open) => !open); }} aria-label="Эмодзи и стикеры" aria-expanded={expressionOpen}>
            <Smile size={20} />
          </button>
          {expressionOpen && (
            <div className="attach-menu expression-menu" role="group" aria-label="Эмодзи и стикеры">
              <button type="button" aria-label="Добавить эмодзи" onClick={() => { setExpressionOpen(false); onEmoji(); }}><Smile size={18} /> Эмодзи</button>
              <button type="button" aria-label="Стикеры" onClick={() => { setExpressionOpen(false); onStickers(); }}><Sticker size={18} /> Стикеры</button>
            </div>
          )}
        </div>
        {(!value.trim() || recording) && <button
          type="button"
          className={`attach-button voice-button ${recording ? "recording" : ""}`}
          onClick={onToggleVoice}
          aria-label={recording ? "Остановить запись" : "Записать голосовое"}
          title={recording ? `Остановить запись · ${recordingSeconds} сек.` : "Голосовое сообщение"}
        >
          <Mic size={20} />
          {recording && <span>{recordingSeconds}s</span>}
        </button>}
        {(value.trim() || editing) && <button
          type="submit"
          className="send-button"
          aria-label={editing ? "Сохранить изменения" : "Отправить сообщение"}
          disabled={!value.trim()}
        >
          {editing ? <CheckCheck size={20} /> : <Send size={20} />}
        </button>}
      </form>
    </>
  );
}
