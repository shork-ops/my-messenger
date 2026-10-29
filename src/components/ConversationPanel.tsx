import { Fragment } from "react";
import type { ComponentProps, MutableRefObject } from "react";
import { ChevronLeft, MoreVertical, Phone, Pin, Search, Video, X } from "lucide-react";
import Avatar from "./Avatar";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import SearchHits from "./SearchHits";
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
          <button onClick={onToggleProfile} aria-label="Показать профиль">
            <MoreVertical />
          </button>
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

      <div className="messages-area" ref={messagesRef}>
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
