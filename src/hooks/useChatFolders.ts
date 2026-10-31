import { useCallback, useEffect } from "react";
import { scopedKey } from "../lib/accountScope";
import { useOwnerStorage } from "../lib/useOwnerStorage";
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

/**
 * The folder list, kept in local storage.
 *
 * Folders are the reader's own shelf, not shared state: a chat being in "Работа" is
 * one person's opinion, and syncing it would push that opinion on everyone else in the
 * conversation.
 *
 * It is also *one person's* shelf on a shared browser: the list is stored inside the account's
 * namespace and is re-derived when the account changes, so a folder someone made in their account
 * does not appear in the next account's sidebar even for one frame.
 */
export function useChatFolders(accountId: string | null) {
  const { value: folders, setValue: setFolders, store } = useOwnerStorage<Folder[]>({
    accountId,
    key: FOLDERS_STORAGE_KEY,
    read: parseFolders,
    write: serializeFolders,
  });

  // Another tab of the same account should keep this one in step; another account's tab must not.
  useEffect(() => {
    const fullKey = scopedKey(store.owner, FOLDERS_STORAGE_KEY);
    const onStorage = (event: StorageEvent) => {
      if (event.key === fullKey) setFolders(parseFolders(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store, setFolders]);

  const createFolder = useCallback(
    (name: string) => {
      setFolders((current) => {
        if (current.length >= MAX_FOLDERS) return current;
        return [...current, { id: newFolderId(current), name, chatIds: [] }];
      });
    },
    [setFolders]
  );

  const deleteFolder = useCallback(
    (id: string) => {
      setFolders((current) => current.filter((folder) => folder.id !== id));
    },
    [setFolders]
  );

  // The rules for a name live in one place, so renaming cannot accept something that
  // creating would have refused.
  const renameFolder = useCallback(
    (id: string, name: string) => {
      setFolders((current) => renameFolderIn(current, id, name));
    },
    [setFolders]
  );

  const moveFolder = useCallback(
    (id: string, direction: "up" | "down") => {
      setFolders((current) => moveFolderIn(current, id, direction));
    },
    [setFolders]
  );

  const toggleChat = useCallback(
    (id: string, chatId: string | number) => {
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
    },
    [setFolders]
  );

  return { folders, createFolder, deleteFolder, renameFolder, moveFolder, toggleChat };
}
