import { MessageCircle, MoreVertical, Paperclip, PencilLine, Send, X, Mic } from "lucide-react";
import Avatar from "./Avatar";
import { friends } from "../lib/constants";
import { hasUserVoted, pollPercent, pollTotal } from "../lib/polls";
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
        <img className="attachment-image" src={attachment.data} alt={attachment.name} />
      ) : attachment.type.startsWith("video/") ? (
        <video className="attachment-video" controls playsInline src={attachment.data} />
      ) : attachment.type.startsWith("audio/") ? (
        <div className="voice-attachment">
          <Mic size={17} />
          <audio controls src={attachment.data} />
          <a href={attachment.data} download={attachment.name}>
            Скачать
          </a>
        </div>
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
  onToggleActions: () => void;
  onVote: (optionId: string) => void;
  onToggleReaction: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
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
  onToggleActions,
  onVote,
  onToggleReaction,
  onReply,
  onCopy,
  onEffect,
  onEdit,
  onDelete,
  onGameInvite,
}: MessageBubbleProps) {
  return (
    <div className={`message-line ${message.mine ? "mine" : ""}`}>
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
          {message.poll ? (
            <PollCard poll={message.poll} accountId={accountId} profileName={profileName} onVote={onVote} />
          ) : message.attachment ? (
            <AttachmentCard attachment={message.attachment} />
          ) : (
            message.text.split(/(@[\p{L}\p{N}_]+)/gu).map((part, partIndex) =>
              part.startsWith("@") ? (
                <strong className="message-mention" key={partIndex}>
                  {part}
                </strong>
              ) : (
                part
              )
            )
          )}
          <span className="message-time">
            {message.edited ? "изменено · " : ""}
            {message.time}
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
              <button type="button" onClick={() => onToggleReaction("❤️")}>
                ❤️
              </button>
              <button type="button" onClick={() => onToggleReaction("👍")}>
                👍
              </button>
              <button type="button" className="effect-action" onClick={() => onEffect("sparkle")} title="Эффект: искры">
                ✦
              </button>
              <button type="button" className="effect-action" onClick={() => onEffect("hearts")} title="Эффект: сердечки">
                ♥
              </button>
              <button type="button" className="effect-action" onClick={() => onEffect("fireworks")} title="Эффект: салют">
                ✧
              </button>
              <button type="button" className="effect-action" onClick={() => onEffect("glow")} title="Эффект: сияние">
                ✺
              </button>
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
