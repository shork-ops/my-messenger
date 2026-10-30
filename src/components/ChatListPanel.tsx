import { FolderInput, Megaphone, PencilLine, Search, Trash2 } from "lucide-react";
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
}: ChatListPanelProps) {
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
          <button key={item.id} className={filter === item.id ? "active" : ""} onClick={() => onFilterChange(item.id)}>
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
              onTogglePin(chat);
            }}
            onClick={() => onSelectChat(chat)}
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
          {/* Filing a chat into a folder had no way in: the picker existed and nothing
              opened it. It is offered only once there is a folder to file into. */}
          {onPickFolders && folders.length > 0 ? (
            <button
              type="button"
              className="chat-file-button"
              aria-label={`Разложить чат «${chat.name}» по папкам`}
              title="Разложить по папкам"
              onClick={() => onPickFolders(chat)}
            >
              <FolderInput size={14} />
            </button>
          ) : null}
          {/* Deleting the conversation, from the row rather than only from inside it: a chat
              nobody wants back should not have to be opened to be got rid of. It confirms
              first, because the next tap on that spot would otherwise land on whatever moved up. */}
          {onDeleteChat ? (
            <button
              type="button"
              className="chat-delete-button"
              aria-label={`Удалить чат «${chat.name}»`}
              title="Удалить чат"
              onClick={() => onDeleteChat(chat)}
            >
              <Trash2 size={14} />
            </button>
          ) : null}
          </div>
        ))}
        {!hasVisibleChats && <div className="empty-search">По этим фильтрам чатов нет</div>}
      </div>
    </section>
  );
}
