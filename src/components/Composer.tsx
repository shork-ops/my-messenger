import type { ChangeEvent, FormEvent, MutableRefObject } from "react";
import { CheckCheck, Image, Mic, Paperclip, Send, Smile, Users, X } from "lucide-react";
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
  onToggleVoice: () => void;
  onSubmit: (event: FormEvent) => void;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onChooseMention: (name: string) => void;
  onAttachment: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenGallery: () => void;
  onOpenPoll: () => void;
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
  onToggleVoice,
  onSubmit,
  onCancelEdit,
  onCancelReply,
  onChooseMention,
  onAttachment,
  onOpenGallery,
  onOpenPoll,
}: ComposerProps) {
  const value = editing ? editDraft : draft;

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
          onChange={onAttachment}
        />
        <button type="button" className="attach-button" onClick={onOpenGallery} aria-label="Галерея медиа" title="Галерея изображений">
          <Image size={20} />
        </button>
        <button type="button" className="attach-button" onClick={onOpenPoll} aria-label="Создать опрос" title="Создать опрос">
          <Users size={19} />
        </button>
        <button type="button" className="attach-button" onClick={() => fileInputRef.current?.click()} aria-label="Прикрепить файл" title="Прикрепить файл">
          <Paperclip size={21} />
        </button>
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
