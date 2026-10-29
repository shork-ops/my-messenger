import { useCallback, useEffect, useState } from "react";
import { FOLDERS_STORAGE_KEY, MAX_FOLDERS, parseFolders, serializeFolders, type Folder } from "../lib/chatFolders";

/**
 * The folder list, kept in local storage.
 *
 * Folders are the reader's own shelf, not shared state: a chat being in "Работа" is
 * one person's opinion, and syncing it would push that opinion on everyone else in the
 * conversation.
 */
export function useChatFolders() {
  const [folders, setFolders] = useState<Folder[]>(() => {
    try {
      return parseFolders(window.localStorage.getItem(FOLDERS_STORAGE_KEY));
    } catch {
      // Private mode can refuse even a read; an empty shelf is fine.
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(FOLDERS_STORAGE_KEY, serializeFolders(folders));
    } catch {
      // A full quota must not break the chat list in front of it.
    }
  }, [folders]);

  const createFolder = useCallback((name: string) => {
    setFolders((current) => {
      if (current.length >= MAX_FOLDERS) return current;
      return [...current, { id: `f${Date.now().toString(36)}`, name, chatIds: [] }];
    });
  }, []);

  const deleteFolder = useCallback((id: string) => {
    setFolders((current) => current.filter((folder) => folder.id !== id));
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    setFolders((current) => current.map((folder) => (folder.id === id ? { ...folder, name } : folder)));
  }, []);

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
  }, []);

  return { folders, createFolder, deleteFolder, renameFolder, toggleChat };
}
