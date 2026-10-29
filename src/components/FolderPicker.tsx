/**
 * Chooses which folders a conversation belongs to.
 *
 * A chat can be in several folders, so this is a set of checkboxes rather than a
 * single choice: "работа" and "срочное" are not mutually exclusive.
 */
import { Check } from "lucide-react";
import { folderIdsForChat, type Folder } from "../lib/chatFolders";
import type { Chat } from "../types";

type FolderPickerProps = {
  chat: Chat;
  folders: Folder[];
  onToggle: (folderId: string, chatId: string | number) => void;
  onClose: () => void;
};

export default function FolderPicker({ chat, folders, onToggle, onClose }: FolderPickerProps) {
  const current = folderIdsForChat(folders, chat.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="folder-picker" aria-label="Папки" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>{chat.name}</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        {folders.length === 0 ? (
          <p className="folder-picker-empty">Сначала создайте папку над списком чатов.</p>
        ) : (
          <ul>
            {folders.map((folder) => {
              const inside = current.includes(folder.id);
              return (
                <li key={folder.id}>
                  <button
                    type="button"
                    className={inside ? "folder-option active" : "folder-option"}
                    aria-pressed={inside}
                    onClick={() => onToggle(folder.id, chat.id)}
                  >
                    <span className="folder-option-check">{inside && <Check size={14} />}</span>
                    {folder.name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
