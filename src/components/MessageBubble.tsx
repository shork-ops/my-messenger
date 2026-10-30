import { useEffect, useRef, useState } from "react";
import { Forward, MessageCircle, MoreVertical, Paperclip, PencilLine, Pin, Send, Star, Trash2, X } from "lucide-react";
import Avatar from "./Avatar";
import VoicePlayer from "./VoicePlayer";
import { friends } from "../lib/constants";
import { hasUserVoted, pollPercent, pollTotal } from "../lib/polls";
import { splitForward } from "../lib/messageActions";
import MessageBody from "./MessageBody";
import { EFFECTS, effectByKey } from "../lib/effects";
import { formatBytes } from "../lib/media";
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

function AttachmentCard({
  attachment,
  autoload,
}: {
  attachment: NonNullable<Message["attachment"]>;
  /** False when the download policy says this picture waits for a tap. */
  autoload: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const show = autoload || revealed;

  return (
    <div className="attachment-card">
      {attachment.type.startsWith("image/") ? (
        show ? (
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
        ) : (
          // The shape and the size are shown before the bytes are fetched, so the
          // tap is an informed one rather than a guess at what is behind it.
          <button
            type="button"
            className="attachment-hold"
            onClick={() => setRevealed(true)}
            aria-label={`Загрузить изображение ${attachment.name}`}
          >
            <span className="attachment-hold-label">{attachment.name}</span>
            <span className="attachment-hold-hint">{formatBytes(attachment.size)} · нажмите, чтобы загрузить</span>
          </button>
        )
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

/** The mark drawn on a message that carries an effect: the same symbol the menu shows. */
function effectMark(effect: MessageEffect): string {
  return effectByKey(effect)?.symbol ?? "";
}

type MessageBubbleProps = {
  message: Message;
  /** Whether to show who spoke: the first message of a run in a group. */
  showAuthor: boolean;
  /** Whether the conversation is a group, where each message carries a face. */
  groupContext: boolean;
  /** Whether this message continues the one above it from the same person. */
  continuesRun: boolean;
  /** Whether this is the last message of its run. */
  endsRun: boolean;
  /** Whether pictures in this conversation load without a tap. */
  autoloadMedia: boolean;
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
  /** Removes the message for this account only. */
  onDeleteLocal: () => void;
  /** Removes it for everyone; only offered to the author. */
  onDelete: () => void;
  onGameInvite: () => void;
};

export default function MessageBubble({
  message,
  showAuthor,
  groupContext,
  continuesRun,
  endsRun,
  autoloadMedia,
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
  onDeleteLocal,
  onDelete,
  onGameInvite,
}: MessageBubbleProps) {
  // Which way the action menu opens. Upwards is the natural direction beside a bubble,
  // but there has to be room above it; otherwise the menu is placed below instead.
  const [menuBelow, setMenuBelow] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    const toggle = toggleRef.current;
    const menu = menuRef.current;
    if (!toggle || !menu) return;
    // Measure after the menu has been laid out, then decide once.
    const needed = menu.offsetHeight;
    const room = toggle.getBoundingClientRect().top;
    setMenuBelow(room < needed + 16);

    // A menu belongs to the message it was opened on. Scrolling the thread detaches it
    // from that message, and it was left hanging above the viewport, so it closes.
    const area = menu.closest(".messages-area");
    const onScroll = () => onToggleActions();
    if (area) area.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (area) area.removeEventListener("scroll", onScroll);
    };
  }, [actionsOpen, onToggleActions]);

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
      data-remote-id={message.remoteId ?? undefined}
      className={`message-line ${message.mine ? "mine" : ""} ${continuesRun ? "continues-run" : "starts-run"} ${endsRun ? "ends-run" : "mid-run"}`}
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
      {/* In a one-to-one chat there is only one other person, so a face and a name on every
          line say nothing that the header has not already said. In a group they are the whole
          point: they are how a reader tells who spoke. */}
      {!message.mine && groupContext && (
        <Avatar color={friends.find((friend) => friend.name === message.author)?.color ?? "blue"} small>
          {message.author.slice(0, 1)}
        </Avatar>
      )}
      <div className="message-content">
        {showAuthor && !message.mine && <strong className="message-author">{message.author}</strong>}
        <div className={`bubble ${message.mine ? "mine-bubble" : ""} ${continuesRun ? "bubble-continues" : ""} ${endsRun ? "bubble-ends" : "bubble-mid"} ${message.effect ? `message-effect-${message.effect}` : ""}`}>
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
            <AttachmentCard attachment={message.attachment} autoload={autoloadMedia} />
          ) : (
            <MessageBody text={forwardRelease.label ? forwardRelease.body : message.text} />
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
              {effectMark(message.effect)}
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
            aria-expanded={actionsOpen}
            ref={toggleRef}
          >
            <MoreVertical size={15} />
          </button>
          {actionsOpen && (
            <div className={menuBelow ? "message-actions below" : "message-actions"} ref={menuRef}>
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
              {/* An effect decorates the message it is attached to, so it belongs to whoever
                  wrote it. Offering the stickers on someone else's message invited a choice
                  the server then refused, and the refusal was silent. */}
              {message.mine && (
                <span className="message-actions-group effect-group" role="group" aria-label="Эффекты">
                  {EFFECTS.map((effect) => (
                    <button
                      key={effect.key}
                      type="button"
                      className={`effect-action effect-tone-${effect.tone}`}
                      onClick={() => onEffect(effect.key)}
                      title={`Эффект: ${effect.label}`}
                      aria-label={`Эффект: ${effect.label}`}
                      // The current effect is marked so the menu answers "which one is on"
                      // rather than making the reader recall the colour.
                      aria-pressed={message.effect === effect.key}
                    >
                      {effect.symbol}
                    </button>
                  ))}
                </span>
              )}
              {message.mine && (
                <button type="button" onClick={onEdit} aria-label="Редактировать сообщение">
                  <PencilLine size={13} /> Изменить
                </button>
              )}
              {/* Everyone can clear a message from their own view; only the
                  author can take it away from everyone else. */}
              <button type="button" onClick={onDeleteLocal} aria-label="Удалить у себя">
                <X size={13} /> У себя
              </button>
              {message.mine && (
                <button type="button" onClick={onDelete} aria-label="Удалить у всех">
                  <Trash2 size={13} /> У всех
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
