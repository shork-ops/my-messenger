import { Fragment } from "react";
import type { ComponentProps, MutableRefObject } from "react";
import { MoreVertical, Phone, Pin, Search, Video, X } from "lucide-react";
import Avatar from "./Avatar";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import { dateLabel } from "../lib/format";
import type { Chat, Message, MessageEffect } from "../types";

type ConversationPanelProps = {
  chat: Chat;
  isDemoMode: boolean;
  accountId: string | null;
  profileName: string;
  searchOpen: boolean;
  searchValue: string;
  onToggleSearch: () => void;
  onSearchChange: (value: string) => void;
  onCloseSearch: () => void;
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
  onEffect: (messageId: number, effect: MessageEffect) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: number) => void;
  onGameInvite: () => void;
  endRef: MutableRefObject<HTMLDivElement | null>;
  composer: ComponentProps<typeof Composer>;
};

export default function ConversationPanel({
  chat,
  isDemoMode,
  accountId,
  profileName,
  searchOpen,
  searchValue,
  onToggleSearch,
  onSearchChange,
  onCloseSearch,
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
  onEffect,
  onEdit,
  onDelete,
  onGameInvite,
  endRef,
  composer,
}: ConversationPanelProps) {
  const subtitle =
    chat.id === 0
      ? "Создай чат, чтобы начать"
      : chat.group
        ? `${chat.members?.length ?? 1} участника(ов)`
        : chat.remoteId
          ? "Облачный диалог"
          : "Локальный чат";

  return (
    <section className="conversation-panel">
      <header className="conversation-header">
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

      <div className="messages-area">
        {chat.messages.length > 0 && !chat.messages.some((message) => message.createdAt) && (
          <div className="date-divider">
            <span>История переписки</span>
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
                onToggleActions={() => onToggleActions(message.id)}
                onVote={(optionId) => onVote(message.id, optionId)}
                onToggleReaction={(emoji) => onToggleReaction(message.id, emoji)}
                onReply={() => onReply(message)}
                onCopy={() => onCopy(message)}
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

      <Composer {...composer} />
    </section>
  );
}
