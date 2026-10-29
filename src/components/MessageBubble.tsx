import { useEffect, useRef } from "react";
import { Forward, MessageCircle, MoreVertical, Paperclip, PencilLine, Pin, Send, Star, X } from "lucide-react";
import Avatar from "./Avatar";
import VoicePlayer from "./VoicePlayer";
import { friends } from "../lib/constants";
import { hasUserVoted, pollPercent, pollTotal } from "../lib/polls";
import { splitForward } from "../lib/messageActions";
import type { Message, MessageEffect, Poll } from "../types";

type VoteHandler = (optionId: string) => void;

function PollCard({ poll, accountId, profileName, onVote }: { poll: Poll; accountId: string | null; profileName: string; onVote: VoteHandler }) {
  const total = pollTotal(poll);
  const voted = hasUserVoted(poll, accountId || profileName);
  return (
    <div className="poll-card">
      <div className="poll-heading">
        <strong>📊 {poll.question}</strong>
        <span>{total} голосов</span>
      </div>
      {poll.options.map((option) => {
        const chosen = option.votes.includes(accountId || profileName);
        const percent = pollPercent(option.votes.length, total);
        return (
          <button
            type="button"
            className={`poll-option ${chosen ? "chosen" : ""}`}
            key={option.id}
            onClick={() => onVote(option.id)}
            aria-label={`${option.text}: ${option.votes.length} голосов, ${percent}%${chosen ? ", ваш выбор" : ""}`}
          >
            <span className="poll-option-label">
              <span>
                {chosen && <b className="poll-check">✓ </b>}
                {option.text}
              </span>
              <b className="poll-result">
                {option.votes.length} · {percent}%
              </b>
            </span>
            <span className="poll-track">
              <i style={{ width: `${percent}%` }} />
            </span>
          </button>
        );
      })}
      <small>{voted ? "Ваш голос учтён · нажмите другой вариант, чтобы изменить выбор" : "Нажмите на вариант, чтобы проголосовать"}</small>
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: NonNullable<Message["attachment"]> }) {
  return (
    <div className="attachment-card">
      {attachment.type.startsWith("image/") ? (
        // The inline thumbnail paints instantly; the signed URL replaces it
        // once the browser has the full-size image.
        <img
          className="attachment-image"
          src={attachment.thumbnail || attachment.data}
          data-full-src={attachment.thumbnail ? attachment.data : undefined}
          alt={attachment.name}
          loading="lazy"
          onError={(event) => {
            const full = event.currentTarget.dataset.fullSrc;
            if (full && event.currentTarget.src !== full) event.currentTarget.src = full;
          }}
        />
      ) : attachment.type.startsWith("video/") ? (
        <video className="attachment-video" controls playsInline src={attachment.data} />
      ) : attachment.type.startsWith("audio/") ? (
        <VoicePlayer attachment={attachment} />
      ) : (
        <a className="attachment-file" href={attachment.data} download={attachment.name}>
          <Paperclip size={18} />
          <span>
            <strong>{attachment.name}</strong>
            <small>
              {Math.max(1, Math.round(attachment.size / 1024))} КБ · Скачать
            </small>
          </span>
        </a>
      )}
      <span className="attachment-caption">{attachment.name}</span>
    </div>
  );
}

const EFFECT_MARKS: Record<MessageEffect, string> = {
  sparkle: "✦",
  hearts: "♥",
  fireworks: "✧",
  glow: "✺",
};

type MessageBubbleProps = {
  message: Message;
  accountId: string | null;
  profileName: string;
  actionsOpen: boolean;
  showGamePreview: boolean;
  receipt?: "sent" | "read" | null;
  onToggleActions: () => void;
  onVote: (optionId: string) => void;
  onToggleReaction: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onForward: () => void;
  onFavourite: () => void;
  onTogglePin: () => void;
  pinned: boolean;
  onEffect: (effect: MessageEffect) => void;
  onEdit: () => void;
  onDelete: () => void;
  onGameInvite: () => void;
};

export default function MessageBubble({
  message,
  accountId,
  profileName,
  actionsOpen,
  showGamePreview,
  receipt,
  onToggleActions,
  onVote,
  onToggleReaction,
  onReply,
  onCopy,
  onForward,
  onFavourite,
  onTogglePin,
  pinned,
  onEffect,
  onEdit,
  onDelete,
  onGameInvite,
}: MessageBubbleProps) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  function clearPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  useEffect(() => clearPress, []);

  function startPress() {
    longPressed.current = false;
    clearPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onToggleActions();
    }, 450);
  }

  // A long press must not also fire the click underneath it.
  function handleClickCapture(event: React.MouseEvent) {
    if (longPressed.current) {
      longPressed.current = false;
      event.stopPropagation();
      event.preventDefault();
    }
  }
  // Forwarded bodies carry a marker line, which renders as a label instead of text.
  const forwardRelease = splitForward(message.text);
  return (
    <div
      className={`message-line ${message.mine ? "mine" : ""}`}
      onPointerDown={startPress}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(event) => {
        event.preventDefault();
        onToggleActions();
      }}
      onClickCapture={handleClickCapture}
    >
      {!message.mine && (
        <Avatar color={friends.find((friend) => friend.name === message.author)?.color ?? "blue"} small>
          {message.author.slice(0, 1)}
        </Avatar>
      )}
      <div className="message-content">
        {!message.mine && <strong className="message-author">{message.author}</strong>}
        <div className={`bubble ${message.mine ? "mine-bubble" : ""} ${message.effect ? `message-effect-${message.effect}` : ""}`}>
          {message.replyTo && (
            <div className="reply-quote">
              <strong>{message.replyTo.author}</strong>
              <span>{message.replyTo.text}</span>
            </div>
          )}
          {/* A forward is a normal message whose body starts with a marker line. */}
          {forwardRelease.label && (
            <div className="forward-label">
              <Forward size={12} /> {forwardRelease.label.replace("↪ ", "")}
            </div>
          )}
          {message.poll ? (
            <PollCard poll={message.poll} accountId={accountId} profileName={profileName} onVote={onVote} />
          ) : message.attachment ? (
            <AttachmentCard attachment={message.attachment} />
          ) : (
            <>{(forwardRelease.label ? forwardRelease.body : message.text).split(/(@[\p{L}\p{N}_]+)/gu).map((part, partIndex) =>
              part.startsWith("@") ? (
                <strong className="message-mention" key={partIndex}>
                  {part}
                </strong>
              ) : (
                part
              )
            )}</>
          )}
          <span className="message-time">
            {message.edited ? "изменено · " : ""}
            {message.time}
            {receipt && (
              <span className={`message-receipt ${receipt === "read" ? "read" : ""}`} aria-label={receipt === "read" ? "Прочитано" : "Отправлено"}>
                {receipt === "read" ? "✓✓" : "✓"}
              </span>
            )}
          </span>
          {message.effect && (
            <span className={`message-effect-mark effect-mark-${message.effect}`} aria-hidden="true">
              {EFFECT_MARKS[message.effect]}
            </span>
          )}
        </div>

        {message.reactions && message.reactions.length > 0 && (
          <div className="reaction-list">
            {message.reactions.map((emoji, reactionIndex) => (
              <button key={emoji + reactionIndex} type="button" onClick={() => onToggleReaction(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="message-action-wrap">
          <button
            type="button"
            className="message-menu-toggle"
            onClick={onToggleActions}
            aria-label="Действия с сообщением"
          >
            <MoreVertical size={15} />
          </button>
          {actionsOpen && (
            <div className="message-actions">
              <button type="button" onClick={onReply}>
                <MessageCircle size={13} /> Ответить
              </button>
              <button type="button" onClick={onCopy}>
                <Paperclip size={13} /> Копировать
              </button>
              <button type="button" onClick={onForward} aria-label="Переслать сообщение">
                <Forward size={13} /> Переслать
              </button>
              <button type="button" onClick={onFavourite} aria-label="Сохранить в избранное">
                <Star size={13} /> В избранное
              </button>
              <button type="button" onClick={onTogglePin} aria-label={pinned ? "Открепить сообщение" : "Закрепить сообщение"}>
                <Pin size={13} /> {pinned ? "Открепить" : "Закрепить"}
              </button>
              <span className="message-actions-group" role="group" aria-label="Реакции">
                <button type="button" onClick={() => onToggleReaction("❤️")} aria-label="Реакция ❤️">
                  ❤️
                </button>
                <button type="button" onClick={() => onToggleReaction("👍")} aria-label="Реакция 👍">
                  👍
                </button>
              </span>
              <span className="message-actions-group" role="group" aria-label="Эффекты">
                <button type="button" className="effect-action" onClick={() => onEffect("sparkle")} title="Эффект: искры" aria-label="Эффект: искры">
                  ✦
                </button>
                <button type="button" className="effect-action" onClick={() => onEffect("hearts")} title="Эффект: сердечки" aria-label="Эффект: сердечки">
                  ♥
                </button>
                <button type="button" className="effect-action" onClick={() => onEffect("fireworks")} title="Эффект: салют" aria-label="Эффект: салют">
                  ✧
                </button>
                <button type="button" className="effect-action" onClick={() => onEffect("glow")} title="Эффект: сияние" aria-label="Эффект: сияние">
                  ✺
                </button>
              </span>
              {message.mine && (
                <button type="button" onClick={onEdit} aria-label="Редактировать сообщение">
                  <PencilLine size={13} /> Изменить
                </button>
              )}
              {message.mine && (
                <button type="button" onClick={onDelete} aria-label="Удалить сообщение">
                  <X size={13} /> Удалить
                </button>
              )}
            </div>
          )}
        </div>

        {showGamePreview && (
          <div className="game-preview">
            <div className="game-art">
              <span>D</span>
              <div className="art-orb orb-one" />
              <div className="art-orb orb-two" />
              <div className="art-orb orb-three" />
            </div>
            <div className="game-info">
              <div>
                <strong>Dota 2</strong>
                <small>5 игроков · 19:42</small>
              </div>
              <button type="button" onClick={onGameInvite} aria-label="Пригласить в игру">
                <Send size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
