import { CheckCheck, PencilLine, Search } from "lucide-react";
import Avatar from "./Avatar";
import type { Chat, ChatFilter, UserSearchResult } from "../types";

const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "unread", label: "Непрочитанные" },
  { id: "pinned", label: "Закреплённые" },
  { id: "groups", label: "Группы" },
];

type ChatListPanelProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onNewChat: () => void;
  userSearch: { loading: boolean; items: UserSearchResult[]; openingUserId: string | null };
  onOpenDirectChat: (user: UserSearchResult) => void;
  filter: ChatFilter;
  onFilterChange: (filter: ChatFilter) => void;
  chats: Chat[];
  hasVisibleChats: boolean;
  activeId: number;
  onSelectChat: (chat: Chat) => void;
  onTogglePin: (chat: Chat) => void;
};

export default function ChatListPanel({
  search,
  onSearchChange,
  onNewChat,
  userSearch,
  onOpenDirectChat,
  filter,
  onFilterChange,
  chats,
  hasVisibleChats,
  activeId,
  onSelectChat,
  onTogglePin,
}: ChatListPanelProps) {
  const query = search.trim().replace(/^@/, "");

  return (
    <section className="chat-list-panel">
      <div className="search-row">
        <label className="search-box">
          <Search size={18} />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Поиск чатов или @username..." />
        </label>
        <button className="square-action" onClick={onNewChat} aria-label="Новый чат" title="Создать чат">
          <PencilLine size={20} />
        </button>
      </div>

      {query.length >= 3 && (
        <div className="user-search-results">
          <div className="chat-filters">
            <span>Пользователи</span>
            {userSearch.loading && <small>Поиск...</small>}
          </div>
          {userSearch.items.map((user) => (
            <button key={user.id} type="button" className="chat-row" onClick={() => onOpenDirectChat(user)}>
              <Avatar color="blue">{user.avatar || user.display_name.slice(0, 1).toUpperCase()}</Avatar>
              <span className="chat-row-copy">
                <strong>{user.display_name}</strong>
                <small>@{user.username}</small>
              </span>
              {userSearch.openingUserId === user.id && <small>Открываю…</small>}
            </button>
          ))}
          {!userSearch.loading && userSearch.items.length === 0 && (
            <div className="empty-search">Пользователи с таким username не найдены</div>
          )}
        </div>
      )}

      <div className="chat-filters">
        {FILTERS.map((item) => (
          <button key={item.id} className={filter === item.id ? "active" : ""} onClick={() => onFilterChange(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="chat-list">
        {chats.map((chat) => (
          <button
            key={chat.id}
            className={`chat-row ${chat.id === activeId ? "selected" : ""}`}
            onContextMenu={(event) => {
              event.preventDefault();
              onTogglePin(chat);
            }}
            onClick={() => onSelectChat(chat)}
          >
            <Avatar color={chat.color}>{chat.avatar}</Avatar>
            <span className="chat-row-copy">
              <strong>
                {chat.pinned && <span className="pinned-mark">📌 </span>}
                {chat.name}
              </strong>
              <small>{chat.preview}</small>
            </span>
            <span className="chat-meta">
              <small>{chat.time}</small>
              {chat.unread ? <b>{chat.unread}</b> : chat.id !== activeId ? <CheckCheck size={15} /> : null}
            </span>
          </button>
        ))}
        {!hasVisibleChats && <div className="empty-search">По этим фильтрам чатов нет</div>}
      </div>
    </section>
  );
}
