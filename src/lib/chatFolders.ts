/**
 * Folders for organising conversations.
 *
 * A folder is a name and a set of chat ids, kept locally. Chats from a server are
 * identified by number and chats in the demo build by string, so the id is stored as a
 * string and compared as one — the alternative is a folder that silently empties when
 * the shape of an id changes.
 */

export const FOLDERS_STORAGE_KEY = "nexus-chat-folders";

/** How many folders a person can make before the list stops being useful. */
export const MAX_FOLDERS = 12;

export type Folder = {
  id: string;
  name: string;
  /** Chat ids as strings, so both numeric and textual ids round-trip. */
  chatIds: string[];
};

function isFolder(value: unknown): value is Folder {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Folder>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.chatIds) &&
    candidate.chatIds.every((id) => typeof id === "string")
  );
}

/**
 * Reads folders from storage.
 *
 * Anything that does not look like a folder is dropped rather than repaired: a
 * half-understood list would put conversations in the wrong place, which is worse than
 * an empty one.
 */
export function parseFolders(raw: string | null): Folder[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isFolder).slice(0, MAX_FOLDERS);
}

export function serializeFolders(folders: Folder[]): string {
  return JSON.stringify(folders.slice(0, MAX_FOLDERS));
}

/** A name that is safe to show: trimmed, single-spaced, and not empty. */
export function normalizeFolderName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

/** Whether a name can be used, and why not when it cannot. */
export function folderNameError(name: string, folders: Folder[]): string | null {
  const clean = normalizeFolderName(name);
  if (!clean) return "Введите название папки";
  if (folders.length >= MAX_FOLDERS) return `Не больше ${MAX_FOLDERS} папок`;
  const taken = folders.some((folder) => folder.name.toLowerCase() === clean.toLowerCase());
  if (taken) return "Папка с таким названием уже есть";
  return null;
}

/** Adds a chat to a folder, or removes it when it is already there. */
export function toggleChatInFolder(folder: Folder, chatId: string | number): Folder {
  const id = String(chatId);
  const has = folder.chatIds.includes(id);
  return {
    ...folder,
    chatIds: has ? folder.chatIds.filter((item) => item !== id) : [...folder.chatIds, id],
  };
}

/** The chats in a folder, in the order the chat list already has them. */
export function chatsInFolder<T extends { id: string | number }>(folder: Folder, chats: T[]): T[] {
  const wanted = new Set(folder.chatIds);
  return chats.filter((chat) => wanted.has(String(chat.id)));
}

/** How a folder is labelled with its count. */
export function folderLabel(folder: Folder): string {
  return `${folder.name} · ${folder.chatIds.length}`;
}

/** A chat can be in several folders; this says which ones. */
export function folderIdsForChat(folders: Folder[], chatId: string | number): string[] {
  const id = String(chatId);
  return folders.filter((folder) => folder.chatIds.includes(id)).map((folder) => folder.id);
}

/**
 * Renames a folder, leaving everything else about it alone.
 *
 * The new name goes through the same normalisation as a new folder, so a name that is
 * acceptable at creation is acceptable here and a name that is not is refused the same
 * way. The folder being renamed does not count as taking its own name.
 */
export function renameFolder(folders: Folder[], id: string, name: string): Folder[] {
  const clean = normalizeFolderName(name);
  if (!clean) return folders;
  const clash = folders.some((folder) => folder.id !== id && folder.name.toLowerCase() === clean.toLowerCase());
  if (clash) return folders;
  return folders.map((folder) => (folder.id === id ? { ...folder, name: clean } : folder));
}

/**
 * Moves a folder one place earlier or later.
 *
 * The order is the order of the list, so moving is a swap with the neighbour. At either
 * end the list comes back unchanged rather than wrapping, because a folder that jumps from
 * first to last when nudged looks like a bug.
 */
export function moveFolder(folders: Folder[], id: string, direction: "up" | "down"): Folder[] {
  const index = folders.findIndex((folder) => folder.id === id);
  if (index < 0) return folders;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= folders.length) return folders;
  const next = [...folders];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
