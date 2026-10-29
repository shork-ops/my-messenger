import { Fragment, useEffect, useRef } from "react";
import type { ComponentProps, MutableRefObject } from "react";
import { type WallpaperId, wallpaperBackground, wallpaperSize } from "../lib/wallpaper";
import { Archive, BellOff, BellRing, ChevronLeft, MoreVertical, Phone, Pin, Search, Trash2, UserRound, Video, X } from "lucide-react";
import Avatar from "./Avatar";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import SearchHits from "./SearchHits";
import { firstUnreadIndex } from "../lib/unread";
import { dateLabel, lastSeenLabel } from "../lib/format";
import { receiptFor } from "../lib/readState";
import type { useServerSearch } from "../hooks/useServerSearch";
import type { Chat, Message, MessageEffect } from "../types";

type ConversationPanelProps = {
  chat: Chat;
  /** Returns from the conversation to the chat list. Phones only. */
  onBack: () => void;
  isDemoMode: boolean;
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
  onOpenSearchHit: (createdAt: string) => void;
  onCall: () => void;
  onVideo: () => void;
  onTogglePin: () => void;
  onToggleProfile: () => void;
  /** Deletes this conversation's history on this device. */
  onClearHistory: () => void;
  /** Opens the mute duration chooser. */
  onMute: () => void;
  onUnmute: () => void;
  onArchive: () => void;
  wallpaper: WallpaperId;
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
  messagesRef: MutableRefObject<HTMLDivElement | null>;
  loadingHistory: boolean;
  historyExhausted: boolean;
  onLoadOlder: () => void;
  composer: ComponentProps<typeof Composer>;
};

export default function ConversationPanel({
  chat,
  onBack,
  isDemoMode,
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
  onMute,
  onUnmute,
  onArchive,
  wallpaper,
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
  messagesRef,
  loadingHistory,
  historyExhausted,
  onLoadOlder,
  composer,
}: ConversationPanelProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const unreadDividerRef = useRef<HTMLDivElement | null>(null);

  // Opening a chat with unread messages should land on the first of them rather
  // than at the bottom, or the unread state is decoration instead of a place.
  // Runs once per chat: scrolling again on every incoming message would fight the
  // reader.
  const scrolledForRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrolledForRef.current === chat.id) return;
    if (unreadDividerRef.current && messagesRef.current) {
      const area = messagesRef.current;
      const divider = unreadDividerRef.current;
      // offsetTop is measured from the nearest positioned ancestor, which is not
      // necessarily the scroller. Work from the rectangles instead.
      const areaTop = area.getBoundingClientRect().top;
      const dividerTop = divider.getBoundingClientRect().top;
      const withinContent = dividerTop - areaTop + area.scrollTop;
      // Leave a third of the viewport above the divider so the context is visible.
      area.scrollTop = Math.max(0, withinContent - area.clientHeight / 3);
      scrolledForRef.current = chat.id;
    }
  }, [chat.id, chat.lastReadAt, messagesRef]);

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
      : chat.group
        ? `${chat.members?.length ?? 1} участника(ов)`
        : chat.remoteId
          ? peerOnline
            ? "в сети"
            : peerLastSeenAt
              ? lastSeenLabel(peerLastSeenAt)
              : "Облачный диалог"
          : "Локальный чат";
  const typingLabel =
    typingNames.length === 0 ? "" : typingNames.length === 1 ? `${typingNames[0]} печатает…` : `${typingNames.join(", ")} печатают…`;

  return (
    <section className="conversation-panel">
      <header className="conversation-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="Назад к чатам">
          <ChevronLeft size={22} />
        </button>
        <Avatar color={chat.color}>{chat.avatar}</Avatar>
        <div className="conversation-title">
          <strong>{chat.name}</strong>
          <small>{subtitle}</small>
        </div>
        <div className="conversation-tools">
          <button onClick={onToggleSearch} aria-label="Поиск по переписке" title="Поиск по переписке">
            <Search />
          </button>
          <button onClick={onCall} aria-label="Позвонить">
            <Phone />
          </button>
          <button onClick={onVideo} aria-label="Видеозвонок">
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
                <button type="button" role="menuitem" className="danger" onClick={onClearHistory}>
                  <Trash2 size={18} /> Очистить историю
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
          onOpen={(hit) => onOpenSearchHit(hit.createdAt)}
          onLoadMore={() => void searchHits.loadMore()}
        />
      )}

      {/* The pattern is drawn behind the messages, so bubbles keep their own
          background and the contrast they were checked with. */}
      <div className="messages-area" ref={messagesRef}>
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
        {visibleMessages.map((message, index) => {
          const previous = chat.messages[index - 1];
          // The divider marks where reading left off; not shown while searching,
          // where the visible list is a different set from the conversation.
          const unreadStart = searchValue.trim() ? null : firstUnreadIndex(chat.messages, chat.lastReadAt ?? null);
          const showDivider =
            Boolean(message.createdAt) &&
            (index === 0 || !previous?.createdAt || dateLabel(message.createdAt!) !== dateLabel(previous.createdAt!));
          const showGamePreview =
            isDemoMode && chat.id === 1 && index === chat.messages.length - 1 && !message.mine;
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
              <MessageBubble
                message={message}
                accountId={accountId}
                profileName={profileName}
                actionsOpen={actionsOpenId === message.id}
                showGamePreview={showGamePreview}
                receipt={chat.remoteId ? receiptFor(message, chat.memberReadAt ?? {}, accountId) : null}
                onToggleActions={() => onToggleActions(message.id)}
                onVote={(optionId) => onVote(message.id, optionId)}
                onToggleReaction={(emoji) => onToggleReaction(message.id, emoji)}
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
            </Fragment>
          );
        })}
        <div ref={endRef} />
      </div>

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
      <Composer {...composer} />
    </section>
  );
}
