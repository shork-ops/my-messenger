import { useCallback } from "react";
import { accountStorageKey, useStoredState } from "./useStoredState";
import {
  FOLDERS_STORAGE_KEY,
  MAX_FOLDERS,
  moveFolder as moveFolderIn,
  newFolderId,
  parseFolders,
  renameFolder as renameFolderIn,
  serializeFolders,
  type Folder,
} from "../lib/chatFolders";

/** Personal folders are isolated per account; cloud sync is a separate layer. */
export function useChatFolders(accountId?: string | null) {
  const [folders, setFolders] = useStoredState<Folder[]>(accountStorageKey(FOLDERS_STORAGE_KEY,accountId), parseFolders,serializeFolders);

  const createFolder = useCallback((name: string) => {
    setFolders((current) => {
      if (current.length >= MAX_FOLDERS) return current;
      return [...current, { id: newFolderId(current), name, chatIds: [] }];
    });
  }, [setFolders]);

  const deleteFolder = useCallback((id: string) => {
    setFolders((current) => current.filter((folder) => folder.id !== id));
  }, [setFolders]);

  // The rules for a name live in one place, so renaming cannot accept something that
  // creating would have refused.
  const renameFolder = useCallback((id: string, name: string) => {
    setFolders((current) => renameFolderIn(current, id, name));
  }, [setFolders]);

  const moveFolder = useCallback((id: string, direction: "up" | "down") => {
    setFolders((current) => moveFolderIn(current, id, direction));
  }, [setFolders]);

  const toggleChat = useCallback((id: string, chatId: string | number) => {
    const key = String(chatId);
    setFolders((current) =>
      current.map((folder) =>
        folder.id === id
          ? {
              ...folder,
              chatIds: folder.chatIds.includes(key)
                ? folder.chatIds.filter((item) => item !== key)
                : [...folder.chatIds, key],
            }
          : folder
      )
    );
  }, [setFolders]);

  return { folders, createFolder, deleteFolder, renameFolder, moveFolder, toggleChat };
}
