/**
 * The folder bar above the chat list.
 *
 * Folders sit next to the existing filters rather than inside them, because they are
 * a different axis: "unread" and "Работа" can both be true, and a single row of tabs
 * would make one of them win.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight, FolderPlus, Pencil, X } from "lucide-react";
import { chatsInFolder, folderNameError, normalizeFolderName, type Folder } from "../lib/chatFolders";
import type { Chat } from "../types";

type FolderBarProps = {
  folders: Folder[];
  chats: Chat[];
  activeFolderId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  /** Renames in place. The bar checks the name before calling this. */
  onRename: (id: string, name: string) => void;
  /** Swaps a folder with its neighbour; the ends of the list do nothing. */
  onMove: (id: string, direction: "up" | "down") => void;
};

export default function FolderBar({
  folders,
  chats,
  activeFolderId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onMove,
}: FolderBarProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The folder being renamed and the text in its field. One at a time, because two
  // fields open at once with the same label is a good way to rename the wrong folder.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

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

  function startRename(folder: Folder) {
    setCreating(false);
    setError(null);
    setRenamingId(folder.id);
    setRenameText(folder.name);
  }

  function submitRename() {
    if (!renamingId) return;
    const others = folders.filter((folder) => folder.id !== renamingId);
    // The same rules as a new folder, so a name that was refused at creation is refused
    // here too and the message is identical.
    const message = folderNameError(renameText, others);
    if (message) {
      setError(message);
      return;
    }
    onRename(renamingId, normalizeFolderName(renameText));
    setRenamingId(null);
    setError(null);
  }

  function cancelRename() {
    setRenamingId(null);
    setError(null);
  }

  return (
    <div className="folder-bar">
      {folders.map((folder, index) => {
        const count = chatsInFolder(folder, chats).length;

        if (renamingId === folder.id) {
          return (
            <span key={folder.id} className="folder-new">
              <input
                autoFocus
                value={renameText}
                aria-label={`Новое название папки ${folder.name}`}
                onChange={(event) => {
                  setRenameText(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitRename();
                  if (event.key === "Escape") cancelRename();
                }}
              />
              <button type="button" onClick={submitRename} aria-label="Сохранить название">
                ОК
              </button>
              <button type="button" onClick={cancelRename} aria-label="Отменить переименование">
                <X size={12} />
              </button>
            </span>
          );
        }

        return (
          <span key={folder.id} className={activeFolderId === folder.id ? "folder-chip active" : "folder-chip"}>
            <button
              type="button"
              onClick={() => onSelect(activeFolderId === folder.id ? null : folder.id)}
              onDoubleClick={() => startRename(folder)}
              title="Двойной щелчок — переименовать"
            >
              {folder.name} {count > 0 && <b>{count}</b>}
            </button>
            {/* Both arrows are always drawn, disabled at the ends: hiding them would make
                the bar reflow every time a folder reaches the edge. */}
            <button
              type="button"
              className="folder-move"
              aria-label={`Переместить папку ${folder.name} влево`}
              disabled={index === 0}
              onClick={() => onMove(folder.id, "up")}
            >
              <ChevronLeft size={12} />
            </button>
            <button
              type="button"
              className="folder-move"
              aria-label={`Переместить папку ${folder.name} вправо`}
              disabled={index === folders.length - 1}
              onClick={() => onMove(folder.id, "down")}
            >
              <ChevronRight size={12} />
            </button>
            <button type="button" className="folder-rename" aria-label={`Переименовать папку ${folder.name}`} onClick={() => startRename(folder)}>
              <Pencil size={11} />
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
