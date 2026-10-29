/**
 * The folder bar above the chat list.
 *
 * Folders sit next to the existing filters rather than inside them, because they are
 * a different axis: "unread" and "Работа" can both be true, and a single row of tabs
 * would make one of them win.
 */
import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { chatsInFolder, folderNameError, normalizeFolderName, type Folder } from "../lib/chatFolders";
import type { Chat } from "../types";

type FolderBarProps = {
  folders: Folder[];
  chats: Chat[];
  activeFolderId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
};

export default function FolderBar({ folders, chats, activeFolderId, onSelect, onCreate, onDelete }: FolderBarProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const message = folderNameError(name, folders);
    if (message) {
      setError(message);
      return;
    }
    onCreate(normalizeFolderName(name));
    setName("");
    setError(null);
    setCreating(false);
  }

  return (
    <div className="folder-bar">
      {folders.map((folder) => {
        const count = chatsInFolder(folder, chats).length;
        return (
          <span key={folder.id} className={activeFolderId === folder.id ? "folder-chip active" : "folder-chip"}>
            <button type="button" onClick={() => onSelect(activeFolderId === folder.id ? null : folder.id)}>
              {folder.name} {count > 0 && <b>{count}</b>}
            </button>
            <button type="button" className="folder-remove" aria-label={`Удалить папку ${folder.name}`} onClick={() => onDelete(folder.id)}>
              <X size={12} />
            </button>
          </span>
        );
      })}

      {creating ? (
        <span className="folder-new">
          <input
            autoFocus
            value={name}
            aria-label="Название папки"
            placeholder="Название папки"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
              if (event.key === "Escape") {
                setCreating(false);
                setError(null);
              }
            }}
          />
          <button type="button" onClick={submit}>
            ОК
          </button>
        </span>
      ) : (
        <button type="button" className="folder-add" aria-label="Создать папку" onClick={() => setCreating(true)}>
          <FolderPlus size={14} /> Папка
        </button>
      )}

      {error && <small className="folder-error">{error}</small>}
    </div>
  );
}
