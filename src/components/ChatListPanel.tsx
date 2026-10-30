import { useEffect, useRef, useState } from "react";
import { Archive, Bell, BellOff, FolderInput, Megaphone, MoreHorizontal, PencilLine, Pin, Search, Trash2 } from "lucide-react";
import Avatar from "./Avatar";
import UserAvatar from "./UserAvatar";
import type { Chat, ChatFilter, UserSearchResult } from "../types";
import type { Folder } from "../lib/chatFolders";
import FolderBar from "./FolderBar";
import { muteLabel } from "../lib/chatSettings";

const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "unread", label: "Непрочитанные" },
  { id: "pinned", label: "Закреплённые" },
  { id: "groups", label: "Группы" },
];

/** The archive is its own place, so it is a tab of its own with its size shown. */
const archivedCount = (chats: Chat[]) => chats.filter((chat) => chat.archived).length;

type ChatListPanelProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onNewChat: () => void;
  userSearch: { loading: boolean; items: UserSearchResult[]; openingUserId: string | null };
  onOpenDirectChat: (user: UserSearchResult) => void;
  filter: ChatFilter;
  onFilterChange: (filter: ChatFilter) => void;
  /** Folders shown above the list; the bar renders nothing when there are none. */
  folders: Folder[];
  activeFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onMoveFolder: (id: string, direction: "up" | "down") => void;
  chats: Chat[];
  /** Every chat, unfiltered: the archive tab is offered based on this, not on the rows. */
  allChats: Chat[];
  hasVisibleChats: boolean;
  activeId: number;
  onSelectChat: (chat: Chat) => void;
  onTogglePin: (chat: Chat) => void;
  /** Opens the folder chooser for one conversation. */
  onPickFolders?: (chat: Chat) => void;
  onDeleteChat?: (chat: Chat) => void;
  onMuteChat?: (chat: Chat) => void;
  onArchiveChat?: (chat: Chat) => void;
};

export default function ChatListPanel({
  search,
  onSearchChange,
  onNewChat,
  userSearch,
  onOpenDirectChat,
  filter,
  onFilterChange,
  folders,
  activeFolderId,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onMoveFolder,
  chats,
  allChats,
  hasVisibleChats,
  activeId,
  onSelectChat,
  onTogglePin,
  onPickFolders,
  onDeleteChat,
  onMuteChat,
  onArchiveChat,
}: ChatListPanelProps) {
  const [menuId, setMenuId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (menuId === null) return;
    menuRef.current?.querySelector("button")?.focus();
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuTrigger.current?.contains(target)) setMenuId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuId(null);
        menuTrigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuId]);
  function runAction(action: () => void) {
    setMenuId(null);
    menuTrigger.current?.focus();
    action();
  }
  // One clock for the whole list, so every row agrees on what "muted" means right now.
  const now = new Date();
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

      <FolderBar
        folders={folders}
        chats={allChats}
        activeFolderId={activeFolderId}
        onSelect={onSelectFolder}
        onCreate={onCreateFolder}
        onDelete={onDeleteFolder}
        onRename={onRenameFolder}
        onMove={onMoveFolder}
      />

      <div className="chat-filters">
        {FILTERS.map((item) => (
          <button key={item.id} className={`${filter === item.id ? "active" : ""} filter-${item.id}`} onClick={() => onFilterChange(item.id)}>
            {item.label}
          </button>
        ))}
        {/* Offered only once something is in it: an empty archive is furniture. */}
        {archivedCount(allChats) > 0 && (
          <button className={filter === "archive" ? "active" : ""} onClick={() => onFilterChange("archive")}>
            Архив {archivedCount(allChats)}
          </button>
        )}
      </div>

      <div className="chat-list">
        {chats.map((chat) => (
          <div key={chat.id} className={`chat-row-wrap ${chat.id === activeId ? "selected" : ""}`}>
          <button
            className={`chat-row ${chat.id === activeId ? "selected" : ""}`}
            onContextMenu={(event) => {
              event.preventDefault();
              menuTrigger.current = event.currentTarget;
              setMenuId(chat.id);
            }}
            onClick={() => { setMenuId(null); onSelectChat(chat); }}
          >
            {chat.avatarPath ? (
              <UserAvatar name={chat.name} letter={chat.avatar} avatarPath={chat.avatarPath} color={chat.color} />
            ) : (
              <Avatar color={chat.color}>{chat.avatar}</Avatar>
            )}
            <span className="chat-row-copy">
              <strong>
                {chat.pinned && <span className="pinned-mark">📌 </span>}
                {chat.name}
                {/* A channel says so in the list, before it is opened: the reader should
                    know a conversation there is one-sided without having to try. */}
                {chat.channel && (
                  <span className="channel-badge chat-channel-mark" title="Канал" aria-label="Канал">
                    <Megaphone size={11} />
                  </span>
                )}
              </strong>
              <small>
                {muteLabel(chat.mutedUntil ?? null, now) && (
                  <span className="muted-mark" title={muteLabel(chat.mutedUntil ?? null, now) ?? ""}>
                    {"🔇 "}
                  </span>
                )}
                {chat.preview}
              </small>
            </span>
            <span className="chat-meta">
              <small>{chat.time}</small>
              {chat.unread ? <b>{chat.unread}</b> : null}
            </span>
          </button>
          <button
            type="button"
            className="chat-menu-button"
            aria-label={`Действия с чатом «${chat.name}»`}
            aria-expanded={menuId === chat.id}
            onClick={(event) => {
              menuTrigger.current = event.currentTarget;
              setMenuId(menuId === chat.id ? null : chat.id);
            }}
          ><MoreHorizontal size={20} /></button>
          {menuId === chat.id && (
            <div className="chat-row-menu" role="group" aria-label={`Действия с чатом «${chat.name}»`} ref={menuRef}>
              <button type="button" onClick={() => runAction(() => onTogglePin(chat))}><Pin size={16} />{chat.pinned ? "Открепить" : "Закрепить"}</button>
              {onMuteChat && <button type="button" onClick={() => runAction(() => onMuteChat(chat))}>{muteLabel(chat.mutedUntil ?? null, now) ? <Bell size={16} /> : <BellOff size={16} />}{muteLabel(chat.mutedUntil ?? null, now) ? "Включить звук" : "Отключить звук"}</button>}
              {onArchiveChat && <button type="button" onClick={() => runAction(() => onArchiveChat(chat))}><Archive size={16} />{chat.archived ? "Вернуть из архива" : "В архив"}</button>}
              {onPickFolders && folders.length > 0 && <button type="button" onClick={() => runAction(() => onPickFolders(chat))}><FolderInput size={16} />Разложить по папкам</button>}
              {onDeleteChat && <button type="button" className="danger-action" onClick={() => runAction(() => onDeleteChat(chat))}><Trash2 size={16} />Удалить чат</button>}
            </div>
          )}
          </div>
        ))}
        {!hasVisibleChats && (
          allChats.length === 0 && !query && filter === "all" && activeFolderId === null ? (
            <div className="chat-welcome">
              <PencilLine size={28} aria-hidden="true" />
              <h2>Начните первый разговор</h2>
              <p>Найдите человека по @username или создайте новый чат.</p>
              <button type="button" onClick={onNewChat}>Новый чат</button>
            </div>
          ) : <div className="empty-search">{query ? "Чаты не найдены. Попробуйте другое имя." : filter === "unread" ? "Нет непрочитанных чатов" : "По этим фильтрам чатов нет"}</div>
        )}
      </div>
    </section>
  );
}
