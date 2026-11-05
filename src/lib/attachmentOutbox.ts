import type { Attachment } from "../types";
export type QueuedFile = { blob: Blob; name: string; type: string; lastModified: number };
export type PreparedFile = { blob: Blob; path: string; meta: Omit<Attachment, "data"> };
export type AttachmentJob = {
  key: string;
  owner: string;
  chatId: number;
  remoteChatId: string;
  queuedAt: number;
  files: QueuedFile[];
  viewOnce: boolean;
  videoNoteMs?: number;
  voice?: { duration: number; waveform: number[] };
  prepared?: PreparedFile[];
  body?: string;
  attempts?: number;
  retryable?: boolean;
  nextAttemptAt?: number;
  reason?: string;
};
export class AttachmentQueueFullError extends Error {}
const DATABASE = "nexus-attachment-outbox",
  STORE = "jobs";
export const MAX_QUEUED_FILES_BYTES = 100 * 1024 * 1024,
  MAX_ATTACHMENT_JOBS = 20;
let opening: Promise<IDBDatabase> | null = null;
function validJob(value: unknown): value is AttachmentJob {
  if (!value || typeof value !== "object") return false;
  const job = value as AttachmentJob;
  const blob = (value: unknown): value is Blob =>
    Boolean(
      value &&
        typeof value === "object" &&
        typeof (value as Blob).size === "number" &&
        typeof (value as Blob).slice === "function",
    );
  return (
    typeof job.key === "string" &&
    typeof job.owner === "string" &&
    typeof job.remoteChatId === "string" &&
    Number.isFinite(job.chatId) &&
    Number.isFinite(job.queuedAt) &&
    Array.isArray(job.files) &&
    job.files.length > 0 &&
    job.files.length <= 10 &&
    job.files.every(
      (file) => blob(file.blob) && typeof file.name === "string" && typeof file.type === "string",
    ) &&
    (job.prepared === undefined ||
      (Array.isArray(job.prepared) &&
        job.prepared.length === job.files.length &&
        job.prepared.every(
          (file) =>
            blob(file.blob) &&
            typeof file.path === "string" &&
            file.meta &&
            typeof file.meta.name === "string",
        )))
  );
}
function database(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Хранилище файлов недоступно"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("owner", "owner");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Закрой другую вкладку Nexus и повтори сохранение"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}
export async function loadAttachmentJobs(owner: string): Promise<AttachmentJob[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).index("owner").getAll(owner);
    request.onsuccess = () =>
      resolve(
        (request.result as AttachmentJob[])
          .filter((job) => validJob(job) && job.owner === owner)
          .sort((a, b) => a.queuedAt - b.queuedAt),
      );
    request.onerror = () => reject(request.error);
  });
}
/** All selected groups are committed together; quota failure never evicts earlier files. */
export async function saveAttachmentJobs(jobs: AttachmentJob[]): Promise<void> {
  if (!jobs.length) return;
  const owner = jobs[0].owner;
  if (jobs.some((job) => !validJob(job) || job.owner !== owner))
    throw new Error("Некорректная очередь файлов");
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"),
      store = tx.objectStore(STORE);
    let failure: Error | undefined;
    const existing = store.index("owner").getAll(owner);
    existing.onsuccess = () => {
      const combined = new Map(
        (existing.result as AttachmentJob[]).filter(validJob).map((job) => [job.key, job]),
      );
      for (const job of jobs) combined.set(job.key, job);
      const bytes = [...combined.values()].reduce(
        (sum, job) =>
          sum +
          job.files.reduce((n, file) => n + file.blob.size, 0) +
          (job.prepared
            ? job.prepared.reduce((n, file) => n + file.blob.size, 0)
            : job.files.reduce((n, file) => n + file.blob.size, 0)),
        0,
      );
      if (combined.size > MAX_ATTACHMENT_JOBS || bytes > MAX_QUEUED_FILES_BYTES) {
        failure = new AttachmentQueueFullError(
          "Очередь файлов заполнена. Отправь или удали ожидающие файлы.",
        );
        tx.abort();
        return;
      }
      for (const job of jobs) store.put(job);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure ?? tx.error ?? new Error("Не удалось сохранить файлы"));
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("Не удалось сохранить файлы"));
  });
}
export async function deleteAttachmentJob(owner: string, key: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"),
      store = tx.objectStore(STORE),
      request = store.get(key);
    request.onsuccess = () => {
      if (request.result?.owner === owner) store.delete(key);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
