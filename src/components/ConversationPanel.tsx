import { Fragment, useEffect, useRef, useState } from "react";
import type { ComponentProps, MutableRefObject } from "react";
import { type WallpaperId, wallpaperBackground, wallpaperSize } from "../lib/wallpaper";
import { ArrowDown, ChevronsUp, Download, FolderPlus, Megaphone } from "lucide-react";
import { canPostToChannel, channelSubtitle } from "../lib/channels";
import { ESTIMATED_ITEM_HEIGHT, VIRTUALISE_THRESHOLD, initialWindow } from "../lib/messageWindow";
import { Archive, BellOff, BellRing, ChevronLeft, MoreVertical, Phone, Pin, Search, Trash2, UserRound, Video, X } from "lucide-react";
import Avatar from "./Avatar";
import UserAvatar from "./UserAvatar";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import SearchHits from "./SearchHits";
import { firstUnreadIndex } from "../lib/unread";
import { seenVisible, type PrivacyPrefs } from "../lib/privacyPrefs";
import { jumpButton, scrollTarget } from "../lib/jumpToUnread";
import { dateLabel, lastSeenLabel } from "../lib/format";
import { messageRuns } from "../lib/messageRuns";
import { receiptFor } from "../lib/readState";
import { receiptVisible } from "../lib/privacyPrefs";
import type { useServerSearch } from "../hooks/useServerSearch";
import type { Chat, Message, MessageEffect } from "../types";

type ConversationPanelProps = {
  chat: Chat;
  /** Returns from the conversation to the chat list. Phones only. */
  onBack: () => void;
  onRetry?: (messageId: number) => void;
  isDemoMode: boolean;
  /** What this browser is allowed to draw about the reader and the other side. */
  privacy: PrivacyPrefs;
  accountId: string | null;
  profileName: string;
  searchOpen: boolean;
  searchValue: string;
  onToggleSearch: () => void;
  onSearchChange: (value: string) => void;
  onCloseSearch: () => void;
  /** Full-history results from Postgres, shown above the loaded messages. */
  searchHits: ReturnType<typeof useServerSearch>;
  searchAuthor: (userId: string) => string;
  searchTime: (iso: string) => string;
  onOpenSearchHit: (createdAt: string, remoteId?: string) => void;
  onCall: () => void;
  onVideo: () => void;
  onTogglePin: () => void;
  onToggleProfile: () => void;
  /** Deletes this conversation's history on this device. */
  onClearHistory: () => void;
  onDeleteChat: () => void;
  /** Saves the conversation to a file. */
  onExport: () => void;
  /** Opens the folder chooser. */
  onFolders: () => void;
  /** Opens the mute duration chooser. */
  onMute: () => void;
  onUnmute: () => void;
  onArchive: () => void;
  wallpaper: WallpaperId;
  /** Whether pictures load without a tap, from the download policy. */
  autoloadMedia: boolean;
  chatMenuOpen: boolean;
  onToggleChatMenu: () => void;
  visibleMessages: Message[];
  actionsOpenId: number | null;
  onToggleActions: (messageId: number) => void;
  onVote: (messageId: number, optionId: string) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
  onReply: (message: Message) => void;
  onCopy: (message: Message) => void;
  onForward: (message: Message) => void;
  onFavourite: (message: Message) => void;
  onTogglePinMessage: (message: Message) => void;
  pinnedMessageIds: Set<number>;
  onEffect: (messageId: number, effect: MessageEffect) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: number) => void;
  onDeleteLocal: (messageId: number) => void;
  onGameInvite: () => void;
  typingNames: string[];
  /** Live upload state for the file being sent, if any. */
  uploadProgress: { name: string; percent: number; stage: string } | null;
  peerOnline: boolean;
  peerLastSeenAt: number | null;
  endRef: MutableRefObject<HTMLDivElement | null>;
  /** The scrolling message list, used to keep the newest message in view. */
  listRef: MutableRefObject<HTMLDivElement | null>;
  messagesRef: MutableRefObject<HTMLDivElement | null>;
  /** Remote id of a message a search result pointed at, to scroll to and highlight. */
  revealMessageId?: string | null;
  /** Called once the highlight has been shown, so it is not repeated. */
  onRevealed?: () => void;
  loadingHistory: boolean;
  historyExhausted: boolean;
  onLoadOlder: () => void;
  composer: ComponentProps<typeof Composer>;
};

export default function ConversationPanel({
  chat,
  onBack,
  onRetry,
  isDemoMode,
  /** Whether this browser draws read receipts and the other side's last-seen line. */
  privacy: privacyValue,
  accountId,
  profileName,
  searchOpen,
  searchValue,
  onToggleSearch,
  onSearchChange,
  onCloseSearch,
  searchHits,
  searchAuthor,
  searchTime,
  onOpenSearchHit,
  onCall,
  onVideo,
  onTogglePin,
  onToggleProfile,
  onClearHistory,
  onDeleteChat,
  onExport,
  onFolders,
  onMute,
  onUnmute,
  onArchive,
  wallpaper,
  autoloadMedia,
  chatMenuOpen,
  onToggleChatMenu,
  visibleMessages,
  actionsOpenId,
  onToggleActions,
  onVote,
  onToggleReaction,
  onReply,
  onCopy,
  onForward,
  onFavourite,
  onTogglePinMessage,
  pinnedMessageIds,
  onEffect,
  onEdit,
  onDelete,
  onDeleteLocal,
  onGameInvite,
  typingNames,
  uploadProgress,
  peerOnline,
  peerLastSeenAt,
  endRef,
  listRef,
  messagesRef,
  /** Remote id of a message a search result pointed at, to scroll to and highlight. */
  revealMessageId,
  /** Called once the highlight has been shown, so it is not repeated. */
  onRevealed,
  loadingHistory,
  historyExhausted,
  onLoadOlder,
  composer,
}: ConversationPanelProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const unreadDividerRef = useRef<HTMLDivElement | null>(null);

  // A search result names a message; this puts it where the eye already is. The scroll
  // happens after the browser has laid out the newly loaded pages, and the mark is left
  // on for a moment because a jump with no target to look at is disorienting on its own.
  useEffect(() => {
    if (!revealMessageId) return;
    const area = messagesRef.current;
    if (!area) return;
    const selector = `[data-remote-id="${revealMessageId}"]`;
    const target = area.querySelector<HTMLElement>(selector);
    if (!target) {
      return;
    }
    const areaTop = area.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    // A third of the panel above the message, so the surrounding conversation is read
    // as context rather than as a single orphaned line.
    area.scrollTop = Math.max(0, targetTop - areaTop + area.scrollTop - area.clientHeight / 3);
    target.classList.add("message-revealed");
    const timer = window.setTimeout(() => {
      target.classList.remove("message-revealed");
    }, 2200);
    onRevealed?.();
    return () => window.clearTimeout(timer);
  }, [revealMessageId, messagesRef, onRevealed]);

  // Opening a chat with unread messages should land on the first of them rather
  // than at the bottom, or the unread state is decoration instead of a place.
  // Runs once per chat: scrolling again on every incoming message would fight the
  // reader.
  const scrolledForRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrolledForRef.current === chat.id) return;
    const area = messagesRef.current;
    const divider = unreadDividerRef.current;
    if (!area || !divider) return;

    // The divider exists on the first paint but the list may still be growing: pictures and
    // fonts change every height below it, so a single scroll can miss the target. Repeat on
    // the next few frames and stop as soon as it is in place. The attempt is abandoned when
    // the reader scrolls, because at that point the position is theirs, not ours.
    let attempts = 0;
    let cancelled = false;
    const place = () => {
      if (cancelled) return;
      const list = messagesRef.current;
      const target = unreadDividerRef.current;
      if (!list || !target) return;
      const dividerTop = target.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      const wanted = scrollTarget({ dividerTop, viewportHeight: list.clientHeight, contentHeight: list.scrollHeight });
      list.scrollTop = wanted;
      attempts += 1;
      const settled = Math.abs(list.scrollTop - wanted) <= 1;
      if (settled && attempts >= 3) {
        scrolledForRef.current = chat.id;
        return;
      }
      if (attempts < 8) requestAnimationFrame(place);
      else scrolledForRef.current = chat.id;
    };
    // The reader moving the list is a decision to stop placing them.
    const onWheel = () => {
      cancelled = true;
      scrolledForRef.current = chat.id;
    };
    area.addEventListener("wheel", onWheel, { passive: true, once: true });
    area.addEventListener("touchstart", onWheel, { passive: true, once: true });
    requestAnimationFrame(place);
    return () => {
      cancelled = true;
      area.removeEventListener("wheel", onWheel);
      area.removeEventListener("touchstart", onWheel);
    };
  }, [chat.id, chat.lastReadAt, messagesRef]);

  const unreadStart = searchValue.trim() ? null : firstUnreadIndex(chat.messages, chat.lastReadAt ?? null);

  // The jump button exists to take a reader somewhere they are not, so its presence follows
  // the scroll position rather than a timer. `atBottom` starts true because a chat opens at
  // the end; the listener corrects it on the first scroll.
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const area = messagesRef.current;
    if (!area) return;
    const read = () => setAtBottom(area.scrollHeight - area.clientHeight - area.scrollTop <= 24);
    read();
    area.addEventListener("scroll", read, { passive: true });
    // A resize changes clientHeight without a scroll event, so the state would go stale.
    window.addEventListener("resize", read);
    return () => {
      area.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [messagesRef, chat.id]);

  // Long conversations render a slice. Five thousand messages put sixty thousand elements
  // in the page and took two and a half seconds to open - measured before this existed.
  //
  // A search is exempt: its results are a different set of messages, and the arithmetic below
  // is about positions in the full list. So is a short conversation, where the whole window
  // would be the whole list anyway.
  const total = chat.messages.length;
  const searching = visibleMessages.length !== total;
  const virtualised = !searching && total > VIRTUALISE_THRESHOLD;
  const [renderWindow, setRenderWindow] = useState(() => initialWindow(chat.messages.length));
  useEffect(() => {
    // A different chat, or a conversation that grew past the threshold, starts at the end.
    setRenderWindow(initialWindow(chat.messages.length));
  }, [chat.id]);


  /**
   * The rendered slice of a long conversation.
   *
   * The position of the window is derived from one number and nothing else: how far the list is
   * scrolled, as a fraction of its height. Every version of this that tried to derive the
   * position from the spacer's own height failed the same way - the spacer is a guess, so the
   * number read from it disagreed with the guess that produced it, and the two chased each
   * other for a frame at a time. A ratio cannot disagree with itself.
   *
   * The window keeps a fixed size and slides, never growing or shrinking. Growing needs the
   * scroll position compensated for the height of the messages that appeared above, and each
   * of those compensations is a chance to lose the reader's place; sliding from the ratio needs
   * no compensation at all.
   */
  const [scrollRatio, setScrollRatio] = useState(1);
  // Which conversation the list has been laid out for. Until it has, its maximum scroll is a
  // number the browser has not settled on, and a position read from it would be meaningless.
  const placedRef = useRef<number | null>(null);
  useEffect(() => {
    placedRef.current = null;
    // The ratio describes where the reader was in the *previous* conversation. Carried into a
    // new one it decides the window before anything has been measured, so a chat left at the
    // top opened the next chat at the top too - and because the rendered slice was the first
    // messages rather than the last, the scroll height collapsed and the reader could not get
    // to the end. A conversation is always opened at its end, so the ratio starts there.
    setScrollRatio(1);
  }, [chat.id]);
  const windowSize = initialWindow(chat.messages.length);
  const windowSpan = Math.max(40, windowSize.last - windowSize.first);

  useEffect(() => {
    const area = messagesRef.current;
    if (!area || !virtualised) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = area.scrollHeight - area.clientHeight;
      // The list is laid out lazily, so early in its life the maximum is wrong and any position
      // read from it is too. Only a settled list is trusted, and until then the window stays
      // where it was - at the end, where a conversation is read from.
      if (placedRef.current !== chat.id) {
        if (max > 0 && max - area.scrollTop <= 4) placedRef.current = chat.id;
        return;
      }
      setScrollRatio(max > 0 ? Math.min(1, Math.max(0, area.scrollTop / max)) : 1);
    };
    const onScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(measure);
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      area.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [messagesRef, virtualised, chat.id]);

  // The rendered slice, from the ratio alone.
  const anchor = Math.round(scrollRatio * (total - windowSpan));
  const first = Math.max(0, Math.min(total - windowSpan, anchor));
  const last = Math.min(total, first + windowSpan);
  const windowStart = virtualised ? first : 0;
  const windowEnd = virtualised ? last : total;
  const renderedMessages = virtualised ? chat.messages.slice(windowStart, windowEnd) : visibleMessages;
  const renderedIndexOffset = windowStart;


  const unreadCount = unreadStart === null ? 0 : chat.messages.length - unreadStart;
  const jump = jumpButton({ atBottom, hasUnreadBelow: unreadStart !== null && unreadCount > 0, unreadCount });

  /** Scrolls to the first unread message, or to the end when there is nothing unread. */
  const jumpTo = () => {
    const area = messagesRef.current;
    if (!area) return;
    const divider = unreadDividerRef.current;
    if (jump?.kind === "unread" && divider) {
      const dividerTop = divider.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop;
      area.scrollTo({
        top: scrollTarget({ dividerTop, viewportHeight: area.clientHeight, contentHeight: area.scrollHeight }),
        behavior: "smooth",
      });
      return;
    }
    area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
  };

  // Dismiss the chat menu like any popover: outside click or Escape.
  useEffect(() => {
    if (!chatMenuOpen) return;
    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onToggleChatMenu();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onToggleChatMenu();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [chatMenuOpen, onToggleChatMenu]);
  const subtitle =
    chat.id === 0
      ? "Создай чат, чтобы начать"
      : chat.channel
        // A channel has no presence to report: nobody is "online" on behalf of it, and its
        // subscriber count is the number a reader wants.
        ? channelSubtitle(chat.members?.length ?? 0, chat.unread ?? 0, chat.description)
        : chat.group
        ? `${chat.members?.length ?? 1} участника(ов)`
        : chat.remoteId
          ? seenVisible(
              peerOnline ? "в сети" : peerLastSeenAt ? lastSeenLabel(peerLastSeenAt) : "Облачный диалог",
              privacyValue.lastSeen
            ) ?? "Облачный диалог"
          : "Локальный чат";
  const typingLabel =
    typingNames.length === 0 ? "" : typingNames.length === 1 ? `${typingNames[0]} печатает…` : `${typingNames.join(", ")} печатают…`;

  // Whether this account may write here. An ordinary chat always may; a channel depends on
  // the standing this account has in it.
  const canPost = chat.channel ? canPostToChannel(chat.channelRole) : true;

  // Consecutive messages from one person are named once, at the top of the run.
  const runs = messageRuns(visibleMessages);

  return (
    <section className="conversation-panel">
      <header className="conversation-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="Назад к чатам">
          <ChevronLeft size={22} />
        </button>
        {/* The photo, not just the letter: the chat list showed the photo and the header
            above it showed initials, so the same person looked like two different people. */}
        {chat.avatarPath ? (
          <UserAvatar name={chat.name} letter={chat.avatar} avatarPath={chat.avatarPath} color={chat.color} />
        ) : (
          <Avatar color={chat.color}>{chat.avatar}</Avatar>
        )}
        <button type="button" className="conversation-title" onClick={onToggleProfile} aria-label={`Профиль чата «${chat.name}»`}>
          <strong>
            {chat.name}
            {chat.channel && (
              <span className="channel-badge" title="Канал">
                <Megaphone size={12} />
              </span>
            )}
          </strong>
          <small>{subtitle}</small>
        </button>
        <div className="conversation-tools">
          <button onClick={onToggleSearch} aria-label="Поиск по переписке" title="Поиск по переписке">
            <Search />
          </button>
          <button onClick={onCall} aria-label="Позвонить">
            <Phone />
          </button>
          <button className="header-video-call" onClick={onVideo} aria-label="Видеозвонок">
            <Video />
          </button>
          <button onClick={onTogglePin} aria-label={chat.pinned ? "Открепить чат" : "Закрепить чат"} title={chat.pinned ? "Открепить чат" : "Закрепить чат"}>
            <Pin />
          </button>
          <div className="chat-menu-wrap" ref={menuRef}>
            <button onClick={onToggleChatMenu} aria-label="Меню чата" aria-expanded={chatMenuOpen}>
              <MoreVertical />
            </button>
            {chatMenuOpen && (
              <div className="chat-menu" role="menu">
                <button className="mobile-video-action" type="button" role="menuitem" onClick={() => { onToggleChatMenu(); onVideo(); }}><Video size={18} /> Видеозвонок</button>
                <button className="mobile-video-action" type="button" role="menuitem" onClick={() => { onToggleChatMenu(); onToggleSearch(); }}><Search size={18} /> Поиск по переписке</button>
                <button type="button" role="menuitem" onClick={onToggleProfile}>
                  <UserRound size={18} /> Профиль чата
                </button>
                {chat.mutedUntil ? (
                  <button type="button" role="menuitem" onClick={onUnmute}>
                    <BellRing size={18} /> Включить звук
                  </button>
                ) : (
                  <button type="button" role="menuitem" onClick={onMute}>
                    <BellOff size={18} /> Без звука
                  </button>
                )}
                <button type="button" role="menuitem" onClick={onArchive}>
                  <Archive size={18} /> {chat.archived ? "Вернуть из архива" : "В архив"}
                </button>
                <button type="button" role="menuitem" onClick={onFolders}>
                  <FolderPlus size={18} /> В папку
                </button>
                <button type="button" role="menuitem" onClick={onExport}>
                  <Download size={18} /> Выгрузить переписку
                </button>
                <button type="button" role="menuitem" className="danger" onClick={onClearHistory}>
                  <Trash2 size={18} /> Очистить историю
                </button>
                <button type="button" role="menuitem" className="danger" onClick={onDeleteChat}>
                  <Trash2 size={18} /> Удалить чат
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {searchOpen && (
        <label className="message-search">
          <Search size={16} />
          <input autoFocus value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder="Найти сообщение в этом чате..." />
          <span>{visibleMessages.length}</span>
          <button type="button" onClick={onCloseSearch} aria-label="Закрыть поиск">
            <X size={15} />
          </button>
        </label>
      )}

      {searchOpen && searchValue.trim().length >= 2 && (
        <SearchHits
          hits={searchHits.hits}
          loading={searchHits.loading}
          hasMore={searchHits.hasMore}
          error={searchHits.error}
          authorOf={searchAuthor}
          timeOf={searchTime}
          onOpen={(hit) => onOpenSearchHit(hit.createdAt, hit.id)}
          onLoadMore={() => void searchHits.loadMore()}
        />
      )}

      {/* The pattern is drawn behind the messages, so bubbles keep their own
          background and the contrast they were checked with. */}
      <div className="messages-area" ref={(node) => {
        messagesRef.current = node;
        listRef.current = node;
      }}>
        {wallpaper !== "none" && (
          <span
            className="wallpaper-layer"
            aria-hidden="true"
            style={{
              backgroundImage: wallpaperBackground(wallpaper, "var(--fg)"),
              backgroundSize: wallpaperSize(wallpaper),
            }}
          />
        )}
        {chat.messages.length > 0 && !chat.messages.some((message) => message.createdAt) && (
          <div className="date-divider">
            <span>История переписки</span>
          </div>
        )}
        {chat.remoteId && (
          <div className="history-loader">
            {loadingHistory ? (
              <span>Загружаю историю…</span>
            ) : historyExhausted ? (
              <span>Начало переписки</span>
            ) : (
              <button type="button" onClick={onLoadOlder}>
                Загрузить ещё
              </button>
            )}
          </div>
        )}
        {visibleMessages.length === 0 && (
          <div className="empty-search">{searchValue.trim() ? "Сообщения не найдены" : "Пока нет сообщений. Напиши первым!"}</div>
        )}
        {virtualised && windowStart > 0 && (
          // The space stands in for messages that are not in the DOM. Its height is an
          // estimate, but it only affects where the scrollbar thumb sits: the reader is
          // looking at the slice, which is rendered at its real size.
          <div
            className="window-spacer"
            data-window-start
            aria-hidden="true"
            style={{ height: windowStart * ESTIMATED_ITEM_HEIGHT }}
          />
        )}
        {renderedMessages.map((message, sliceIndex) => {
          const index = sliceIndex + (virtualised ? renderedIndexOffset : 0);
          const previous = chat.messages[index - 1];
          // The divider marks where reading left off; not shown while searching,
          // where the visible list is a different set from the conversation.
                  const showDivider =
            Boolean(message.createdAt) &&
            (index === 0 || !previous?.createdAt || dateLabel(message.createdAt!) !== dateLabel(previous.createdAt!));
          const showGamePreview =
            isDemoMode && chat.id === 1 && index === chat.messages.length - 1 && !message.mine;
          // In a group the speaker is named once per run of their messages, not on every line.
          const run = runs.startsRun[index] !== undefined
            ? { startsRun: runs.startsRun[index], endsRun: runs.endsRun[index], continues: runs.continues[index] }
            : null;
          return (
            <Fragment key={message.id}>
              {showDivider && (
                <div className="date-divider">
                  <span>{dateLabel(message.createdAt!)}</span>
                </div>
              )}
              {unreadStart === index && (
                <div className="unread-divider" role="separator" ref={unreadDividerRef}>
                  <span>Непрочитанные</span>
                </div>
              )}
              <div className="window-item" data-window-item>
              <MessageBubble
                message={message}
                showAuthor={Boolean(chat.group) && (run?.startsRun ?? true)}
                groupContext={Boolean(chat.group)}
                continuesRun={run?.continues ?? false}
                endsRun={run?.endsRun ?? true}
                autoloadMedia={autoloadMedia}
                accountId={accountId}
                profileName={profileName}
                actionsOpen={actionsOpenId === message.id}
                showGamePreview={showGamePreview}
                receipt={chat.remoteId ? receiptVisible(receiptFor(message, chat.memberReadAt ?? {}, accountId), privacyValue.readReceipts) : null}
                onToggleActions={() => onToggleActions(message.id)}
                onVote={(optionId) => onVote(message.id, optionId)}
                onToggleReaction={(emoji) => onToggleReaction(message.id, emoji)}
                onRetry={() => onRetry?.(message.id)}
                onReply={() => onReply(message)}
                onCopy={() => onCopy(message)}
                onForward={() => onForward(message)}
                onFavourite={() => onFavourite(message)}
                onTogglePin={() => onTogglePinMessage(message)}
                pinned={pinnedMessageIds.has(message.id)}
                onEffect={(effect) => onEffect(message.id, effect)}
                onEdit={() => onEdit(message)}
                onDelete={() => onDelete(message.id)}
                onDeleteLocal={() => onDeleteLocal(message.id)}
                onGameInvite={onGameInvite}
              />
              </div>
            </Fragment>
          );
        })}
        <div ref={endRef} />
      </div>

      {jump && (
        <button
          type="button"
          className="jump-button"
          onClick={jumpTo}
          aria-label={jump.kind === "unread" ? `К непрочитанным: ${jump.count}` : "Вниз к последнему сообщению"}
        >
          {jump.kind === "unread" ? <ChevronsUp size={16} /> : <ArrowDown size={16} />}
          {jump.kind === "unread" && <span>{jump.count}</span>}
        </button>
      )}

      {uploadProgress && (
        <div className="upload-progress" role="status">
          <div className="upload-progress-row">
            <span>{uploadProgress.stage}</span>
            <b>{uploadProgress.percent}%</b>
          </div>
          <div className="upload-track">
            <i style={{ width: `${uploadProgress.percent}%` }} />
          </div>
          <small>{uploadProgress.name}</small>
        </div>
      )}

      {typingLabel && (
        <div className="typing-indicator" role="status">
          {typingLabel}
        </div>
      )}
      {canPost ? (
        <Composer {...composer} />
      ) : (
        <div className="channel-readonly" role="note">
          <Megaphone size={16} />
          <span>Вы читаете канал. Писать могут только его авторы.</span>
        </div>
      )}
    </section>
  );
}
