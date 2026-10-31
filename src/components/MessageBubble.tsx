import { useEffect, useRef, useState } from "react";
import { Forward, MessageCircle, MoreVertical, Paperclip, PencilLine, Pin, Send, Star, Trash2, X } from "lucide-react";
import Avatar from "./Avatar";
import VoicePlayer from "./VoicePlayer";
import { friends } from "../lib/constants";
import { hasUserVoted, pollPercent, pollTotal } from "../lib/polls";
import { splitForward } from "../lib/messageActions";
import MessageBody from "./MessageBody";
import { EFFECTS, effectByKey } from "../lib/effects";
import { stickerById } from "../lib/stickers";
import { firstLink } from "../lib/links";
import { useLinkCard } from "../hooks/useLinkCard";
import LinkPreview from "./LinkPreview";
import GameInviteCard from "./games/GameInviteCard";
import { parseInvitation } from "../games/core/invitation";
import AlbumGrid from "./AlbumGrid";
import { formatBytes } from "../lib/media";
import {
  VIEW_ONCE_SECONDS,
  isSpent,
  isViewOnce,
  markSpent,
  nextViewOnceState,
  remainingSeconds,
  viewOnceSpentLabel,
  viewOnceVisible,
  viewOnceWarning,
  type ViewOnceState,
} from "../lib/viewOnce";
import { openViewOnce } from "../lib/viewOnceCloud";
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

/**
 * Single-view media.
 *
 * The image is not painted until the receiver opens it, and after the countdown it is not
 * painted again - not on re-render, not on reopening the conversation. What the interface
 * promises is exactly that: it cannot be looked at twice. It does not promise a screenshot
 * alarm, because a browser cannot reliably give one.
 */
function ViewOnceCard({
  attachment,
  messageKey,
  remoteId,
  mine,
}: {
  attachment: NonNullable<Message["attachment"]>;
  remoteId?: string;
  mine?: boolean;
  /** Identifies this piece of media across unmounts, so "already opened" survives them. */
  messageKey: string;
}) {
  // The initial state is read from storage rather than assumed: coming back to a conversation
  // must not offer a photo that has already been opened.
  const [state, setState] = useState<ViewOnceState>(() => (isSpent(messageKey) ? "spent" : "closed"));
  const [left, setLeft] = useState(VIEW_ONCE_SECONDS);
  const [cloudUrl, setCloudUrl] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const openedRef = useRef(false);
  const cloud = Boolean(remoteId);
  const open = async () => {
    if (opening || openedRef.current) return;
    openedRef.current = true;
    setOpenError("");
    if (cloud) {
      setOpening(true);
      const result = await openViewOnce(remoteId!);
      setOpening(false);
      if (result.spent) { setState("spent"); return; }
      if (!result.url) { openedRef.current = false; setOpenError(result.error || "Фото недоступно"); return; }
      setCloudUrl(result.url);
    }
    openedRef.current = true;
    markSpent(messageKey);
    setState("open");
  };
  const [startedAt, setStartedAt] = useState(0);

  useEffect(() => {
    if (state !== "open") return;
    const started = Date.now();
    setStartedAt(started);
    setLeft(VIEW_ONCE_SECONDS);
    const tick = window.setInterval(() => {
      const remaining = remainingSeconds(started, Date.now());
      setLeft(remaining);
      if (remaining === 0) {
        window.clearInterval(tick);
        markSpent(messageKey);
        setCloudUrl("");
        setState(nextViewOnceState("open"));
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [state, messageKey]);

  if (mine && cloud) return <div className="view-once-card">Одноразовое фото отправлено</div>;
  if (state === "spent") {
    return (
      <div className="view-once-card is-spent" role="status">
        <span className="view-once-spent">{viewOnceSpentLabel()}</span>
      </div>
    );
  }

  if (state === "open" && viewOnceVisible("open")) {
    return (
      <button type="button" className="view-once-card is-open" aria-label="Закрыть одноразовое фото" onClick={() => { setCloudUrl(""); setState("spent"); }}>
        <img className="attachment-image" src={cloud ? cloudUrl : attachment.thumbnail || attachment.data} alt={attachment.name} />
        <span className="view-once-countdown" role="timer" aria-live="polite">
          Осталось {left} с
        </span>
        <span className="view-once-hint" data-started={startedAt}>
          Чтобы закрыть раньше, нажмите
        </span>
      </button>
    );
  }

  return (
    <div className="view-once-card is-closed">
      <p className="view-once-warning">{viewOnceWarning()}</p>
      {openError && <p role="alert">{openError}</p>}
      <button type="button" className="view-once-open" disabled={opening} onClick={() => void open()}>
        1 раз · Открыть фото
      </button>
    </div>
  );
}

function AttachmentCard({
  attachment,
  autoload,
  messageKey,
  remoteId,
  mine,
}: {
  attachment: NonNullable<Message["attachment"]>;
  remoteId?: string;
  mine?: boolean;
  /** False when the download policy says this picture waits for a tap. */
  autoload: boolean;
  /** Identifies the message, so "already opened" is remembered per message, not per file. */
  messageKey: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const show = autoload || revealed;

  if (isViewOnce({ viewOnce: attachment.viewOnce })) {
    return <ViewOnceCard attachment={attachment} messageKey={messageKey} remoteId={remoteId} mine={mine} />;
  }

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
  receipt?: "sent" | "read" | null;
  onToggleActions: () => void;
  onVote: (optionId: string) => void;
  onToggleReaction: (emoji: string) => void;
  onReply: () => void;
  onRetry?: () => void;
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
  receipt,
  onToggleActions,
  onVote,
  onToggleReaction,
  onReply,
  onRetry,
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
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);

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
  // A sticker id from a newer build resolves to nothing; the message then falls back to
  // its text rather than rendering an empty bubble.
  const sticker = message.stickerId ? stickerById(message.stickerId) : undefined;
  const pendingSend = message.sendAt !== undefined && message.sendAt > Date.now();
  // One card per message, for the first link. Two cards for two links in one sentence turn a
  // message into a feed.
  const cardUrl = !message.poll && !message.attachment && !message.stickerId ? firstLink(message.text) : null;
  const linkCard = useLinkCard(cardUrl, Boolean(cardUrl));
  // An invitation is recognised from the message text, so it survives a reload and arrives
  // from the other side as an ordinary message rather than as a separate kind of event.
  const invitation = !message.poll && !message.attachment && !message.stickerId ? parseInvitation(message.text) : null;
  return (
    <div
      data-remote-id={message.remoteId ?? undefined}
      className={`message-line ${message.mine ? "mine" : ""} ${continuesRun ? "continues-run" : "starts-run"} ${endsRun ? "ends-run" : "mid-run"}`}
      onTouchStart={(event) => {
        const target = event.target as HTMLElement;
        const touch = event.touches[0];
        if (event.touches.length !== 1 || !touch || target.closest("button, a, input, textarea") || touch.clientX < 32) {
          touchStart.current = null;
          return;
        }
        touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      }}
      onTouchMove={(event) => {
        const from = touchStart.current;
        const touch = event.touches[0];
        if (!from || !touch) return;
        if (Math.abs(touch.clientX - from.x) > 10 || Math.abs(touch.clientY - from.y) > 10) clearPress();
        if (event.touches.length !== 1) touchStart.current = null;
      }}
      onTouchCancel={() => { touchStart.current = null; clearPress(); }}
      onTouchEnd={(event) => {
        const from = touchStart.current;
        touchStart.current = null;
        const touch = event.changedTouches[0];
        if (!from || !touch || longPressed.current) return;
        if (touch.clientX - from.x >= 64 && Math.abs(touch.clientY - from.y) < 35 && Date.now() - from.time < 700) {
          longPressed.current = true;
          onReply();
        }
      }}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button, a, input, textarea")) startPress();
      }}
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
          ) : sticker ? (
            // A sticker is drawn large and without a bubble background of its own: the
            // picture is the message. The label is the accessible name, since the glyph
            // alone means nothing to a screen reader.
            <span className="message-sticker" role="img" aria-label={`Стикер: ${sticker.label}`}>
              <span className={`sticker-glyph sticker-tone-${sticker.tone}`} aria-hidden="true">
                {sticker.glyph}
              </span>
            </span>
          ) : message.album && message.album.length > 0 ? (
            <AlbumGrid items={message.album} autoload={autoloadMedia} />
          ) : message.attachment ? (
            <AttachmentCard
              attachment={message.attachment}
              autoload={autoloadMedia}
              messageKey={`${accountId || "local"}:${message.remoteId || String(message.id)}`}
              remoteId={message.remoteId}
              mine={message.mine}
            />
          ) : (
            <div className="message-body">
              <MessageBody text={forwardRelease.label ? forwardRelease.body : message.text} />
            </div>
          )}
          {linkCard.status === "ready" && <LinkPreview card={linkCard.card} />}
          <span className="message-time">
            {/* A pending message says when it will go, not when it was typed: the time it
                was typed is of no interest to the person waiting for it. */}
            {pendingSend ? (
              <span className="message-pending" title="Ещё не отправлено">
                отправлю {message.time}
              </span>
            ) : (
              <>
                {message.edited ? "изменено · " : ""}
                {message.time}
              </>
            )}
            {!pendingSend && !message.delivery?.match(/sending|failed/) && receipt && (
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

        {message.delivery === "sending" && <small className="delivery-status" role="status">Отправляется…</small>}
        {message.delivery === "failed" && <button type="button" className="delivery-retry" onClick={onRetry}>Не отправлено · Повторить</button>}
        {message.delivery === "sent" && <small className="delivery-status">Принято сервером</small>}
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

        {invitation && (
          <GameInviteCard
            invitation={invitation}
            viewerIsInvited={!message.mine}
            onOpen={onGameInvite}
          />
        )}
      </div>
    </div>
  );
}
