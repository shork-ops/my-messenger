import { withOutboxLock } from "../lib/outboxLock";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Chat, Message } from "../types";
import { supabase } from "../lib/supabase";
import { MAX_UPLOAD_BYTES, formatBytes, isSupportedFile, blobToDataUrl } from "../lib/media";
import type { PendingAttachment } from "../lib/retryQueue";
import { appendMessage } from "../lib/chats";
import { clockTime } from "../lib/format";
import { formatNoteTime } from "../lib/videoNoteKind";
import { isTransientError } from "../lib/retry";
import { mapMessageRow } from "../lib/messageSync";
import { placeNewMessage } from "../lib/messageOrder";
import {
  loadAttachmentJobs,
  saveAttachmentJobs,
  deleteAttachmentJob,
  AttachmentQueueFullError,
  type AttachmentJob,
} from "../lib/attachmentOutbox";
import { deliverAttachment } from "../lib/attachmentDelivery";

export type UploadProgress = { name: string; percent: number; stage: string };
type State = {
  owner: string;
  alive: boolean;
  busy: boolean;
  running: string | null;
  jobs: Map<string, AttachmentJob>;
  unsaved: Set<string>;
  ready: Promise<void>;
};
export function useAttachmentSender(deps: {
  accountId: string | null;
  profileName: string;
  activeChatId: number;
  chats: Chat[];
  notify: (text: string) => void;
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  recordingStartedRef: { current: number | null };
  setRecordingSeconds: (value: number) => void;
}) {
  const current = useRef(deps);
  current.current = deps;
  const stateRef = useRef<State | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [failedUploads, setFailedUploads] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valid = (state: State) =>
    state.alive && stateRef.current === state && current.current.accountId === state.owner;
  const render = (state: State) => {
    if (!valid(state)) return;
    setFailedUploads(
      [...state.jobs.values()]
        .filter((job) => job.key !== state.running)
        .map((job) => ({
          key: job.key,
          file: new File([job.files[0].blob], job.files[0].name, {
            type: job.files[0].type,
            lastModified: job.files[0].lastModified,
          }),
          chatId: current.current.chats.find((chat) => chat.remoteId === job.remoteChatId)?.id ?? job.chatId,
          viewOnce: job.viewOnce,
          videoNoteMs: job.videoNoteMs,
          fileCount: job.files.length,
          state: job.retryable === false ? ("failed" as const) : ("queued" as const),
          reason: job.reason ?? "В очереди · отправим при подключении",
        })),
    );
  };
  async function drain(state: State) {
    if (!valid(state) || state.busy || !navigator.onLine || !supabase) return;
    if (
      ![...state.jobs.values()].some(
        (job) =>
          job.retryable !== false &&
          (job.nextAttemptAt ?? 0) <= Date.now() &&
          current.current.chats.some((chat) => chat.remoteId === job.remoteChatId),
      )
    )
      return;
    state.busy = true;
    const run = async () => {
      const disk = await loadAttachmentJobs(state.owner);
      if (!valid(state)) return;
      const persisted = new Set(disk.map((job) => job.key));
      for (const key of state.jobs.keys())
        if (!persisted.has(key) && !state.unsaved.has(key)) state.jobs.delete(key);
      for (const job of disk) if (!state.jobs.has(job.key)) state.jobs.set(job.key, job);
      for (const job of [...state.jobs.values()].sort((a, b) => a.queuedAt - b.queuedAt)) {
        if (!valid(state) || !navigator.onLine) break;
        if (
          job.retryable === false ||
          (job.nextAttemptAt ?? 0) > Date.now() ||
          !current.current.chats.some((chat) => chat.remoteId === job.remoteChatId)
        )
          continue;
        state.running = job.key;
        render(state);
        try {
          // Also commits any entry retained only in memory after an earlier quota failure.
          await saveAttachmentJobs([job]);
          state.unsaved.delete(job.key);
          const row = await deliverAttachment(
            supabase!,
            job,
            () => valid(state) && state.jobs.has(job.key),
            (name, percent, stage) => {
              if (valid(state) && current.current.activeChatId === job.chatId)
                setUploadProgress({ name, percent, stage });
            },
          );
          if (!valid(state)) break;
          state.jobs.delete(job.key);
          try {
            await deleteAttachmentJob(state.owner, job.key);
          } catch {
            /* A later restore acknowledges the same server ID. */
          }
          const message = await mapMessageRow(row, {
            accountId: state.owner,
            selfName: current.current.profileName,
            authorName: "Собеседник",
          });
          if (!valid(state)) break;
          if (message)
            current.current.setChats((items) =>
              valid(state)
                ? items.map((chat) =>
                    chat.remoteId === job.remoteChatId
                      ? {
                          ...chat,
                          messages: placeNewMessage(
                            chat.messages.filter(
                              (item) => item.remoteId !== row.id && item.id !== message.id,
                            ),
                            { ...message, delivery: "sent" },
                          ),
                          preview: job.voice
                            ? "🎤 Голосовое сообщение"
                            : job.videoNoteMs !== undefined
                              ? "⭕ " + message.text
                              : "📎 " + message.text,
                          time: message.time,
                        }
                      : chat,
                  )
                : items,
            );
        } catch (error) {
          if (!valid(state) || !state.jobs.has(job.key)) break;
          job.attempts = (job.attempts ?? 0) + 1;
          job.retryable = isTransientError(error) || !navigator.onLine;
          job.nextAttemptAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(job.attempts - 1, 5));
          job.reason = job.retryable
            ? "Ожидаем подключения. Файл сохранён в очереди."
            : "Не удалось отправить. Повтори попытку или убери файл из очереди.";
          try {
            await saveAttachmentJobs([job]);
          } catch {
            job.reason = "Не удалось сохранить файл на устройстве. Не закрывай вкладку и повтори попытку.";
            job.retryable = false;
          }
          if (job.retryable) break;
        } finally {
          state.running = null;
          if (valid(state)) setUploadProgress(null);
          render(state);
        }
      }
    };
    try {
      await withOutboxLock(`nexus-attachment-outbox:${state.owner}`, run);
    } catch {
      for (const job of state.jobs.values()) {
        job.retryable = false;
        job.reason = state.unsaved.has(job.key)
          ? "Хранилище недоступно. Не закрывай вкладку и повтори попытку."
          : "Не удалось открыть сохранённый файл. Повтори попытку.";
      }
      if (valid(state)) current.current.notify("Не удалось прочитать очередь файлов. Повторим подключение.");
    } finally {
      state.busy = false;
      render(state);
    }
  }
  useEffect(() => {
    setUploadProgress(null);
    setFailedUploads([]);
    if (!deps.accountId) {
      stateRef.current = null;
      return;
    }
    const state: State = {
      owner: deps.accountId,
      alive: true,
      busy: false,
      running: null,
      jobs: new Map(),
      unsaved: new Set(),
      ready: Promise.resolve(),
    };
    stateRef.current = state;
    state.ready = loadAttachmentJobs(state.owner)
      .then((jobs) => {
        if (!valid(state)) return;
        for (const job of jobs) if (!state.jobs.has(job.key)) state.jobs.set(job.key, job);
        render(state);
        void drain(state);
      })
      .catch(() => {
        if (valid(state))
          current.current.notify(
            "Не удалось открыть очередь файлов на устройстве. Повторная отправка будет доступна после восстановления хранилища.",
          );
      });
    const reconnect = () => {
      if (valid(state)) void state.ready.then(() => drain(state));
    };
    const online = () => {
      for (const job of state.jobs.values()) if (job.retryable !== false) job.nextAttemptAt = 0;
      reconnect();
    };
    const visible = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    const timer = setInterval(visible, 2000);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      state.alive = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [deps.accountId]);
  useEffect(() => {
    const state = stateRef.current;
    if (state && valid(state)) {
      render(state);
      void state.ready.then(() => drain(state));
    }
  }, [deps.chats]);
  async function dismissFailedUpload(key: string) {
    const state = stateRef.current;
    if (!state || !valid(state) || state.running === key) return;
    try {
      if (!state.unsaved.has(key)) await deleteAttachmentJob(state.owner, key);
    } catch {
      current.current.notify("Не удалось убрать файл из очереди. Повтори попытку.");
      return;
    }
    if (!valid(state)) return;
    state.jobs.delete(key);
    state.unsaved.delete(key);
    render(state);
  }
  async function retryFailedUpload(entry: PendingAttachment) {
    const state = stateRef.current,
      job = state?.jobs.get(entry.key);
    if (!state || !job || !valid(state)) return;
    job.retryable = true;
    job.nextAttemptAt = 0;
    job.reason = undefined;
    render(state);
    await drain(state);
  }
  async function enqueue(
    files: File[],
    options: {
      viewOnce?: boolean;
      videoNoteMs?: number;
      voice?: { duration: number; waveform: number[] };
    } = {},
    target?: HTMLInputElement,
  ) {
    const state = stateRef.current,
      owner = current.current.accountId;
    const chat = current.current.chats.find((item) => item.id === current.current.activeChatId);
    if (!owner || !supabase || !chat?.remoteId || !state || !valid(state)) {
      current.current.notify("Открой облачный диалог, чтобы отправить файл");
      return false;
    }
    await state.ready;
    if (!valid(state)) return false;
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        current.current.notify(`Файл «${file.name}» больше ${formatBytes(MAX_UPLOAD_BYTES)}`);
        return false;
      }
      if (!options.voice && !isSupportedFile(file.type)) {
        current.current.notify(`Формат файла «${file.name}» пока не поддерживается`);
        return false;
      }
    }
    if (options.viewOnce && (!files[0]?.type.startsWith("image/") || files.length !== 1)) {
      current.current.notify("Выбери одно фото для одноразового просмотра");
      return false;
    }
    const groups: File[][] = [];
    for (const file of files) {
      const previous = groups[groups.length - 1];
      if (
        !options.viewOnce &&
        options.videoNoteMs === undefined &&
        !options.voice &&
        file.type.startsWith("image/") &&
        previous?.every((item) => item.type.startsWith("image/")) &&
        previous.length < 10
      )
        previous.push(file);
      else groups.push([file]);
    }
    const jobs: AttachmentJob[] = groups.map((group) => ({
      key: crypto.randomUUID(),
      owner,
      chatId: chat.id,
      remoteChatId: chat.remoteId!,
      queuedAt: Date.now(),
      files: group.map((file) => ({
        blob: file,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
      })),
      viewOnce: Boolean(options.viewOnce),
      videoNoteMs: options.videoNoteMs,
      voice: options.voice,
      retryable: true,
      ...(options.voice
        ? { body: `Голосовое сообщение · ${options.voice.duration} сек.` }
        : options.videoNoteMs !== undefined
          ? { body: `Видеозаметка ${formatNoteTime(options.videoNoteMs)}` }
          : {}),
    }));
    try {
      await saveAttachmentJobs(jobs);
    } catch (error) {
      if (error instanceof AttachmentQueueFullError) {
        if (valid(state)) current.current.notify(error.message);
        return false;
      }
      if (!valid(state)) return false;
      for (const job of jobs) {
        job.retryable = false;
        job.reason = "Не удалось сохранить на устройстве. Не закрывай вкладку и повтори попытку.";
        state.jobs.set(job.key, job);
        state.unsaved.add(job.key);
      }
      render(state);
      current.current.notify(
        "Файлы пока сохранены только в этой вкладке. Освободи место и нажми «Повторить».",
      );
      return false;
    }
    if (!valid(state)) return true;
    for (const job of jobs) state.jobs.set(job.key, job);
    if (target) target.value = "";
    render(state);
    void drain(state);
    return true;
  }
  async function handleAttachment(
    event: ChangeEvent<HTMLInputElement>,
    options: { viewOnce?: boolean; videoNoteMs?: number } = {},
  ) {
    const target = event.target,
      files = Array.from(target.files ?? []);
    if (!files.length) return;
    const viewOnce = options.viewOnce ?? target.dataset.viewOnce === "true";
    delete target.dataset.viewOnce;
    await enqueue(files, { ...options, viewOnce }, target);
  }
  async function sendVoiceMessage(blob: Blob) {
    const duration = Math.max(
      1,
      Math.round((Date.now() - (current.current.recordingStartedRef.current || Date.now())) / 1000),
    );
    const createdAt = Date.now(),
      time = clockTime(),
      extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm",
      name = `voice-${createdAt}.${extension}`;
    const chat = current.current.chats.find((item) => item.id === current.current.activeChatId);
    if (!chat?.remoteId || !supabase || !current.current.accountId) {
      const targetId = current.current.activeChatId,
        owner = current.current.accountId;
      const data = await blobToDataUrl(blob);
      if (current.current.accountId !== owner) return;
      const message: Message = {
        id: createdAt,
        author: current.current.profileName,
        text: `Голосовое сообщение · ${duration} сек.`,
        time,
        mine: true,
        createdAt,
        attachment: { name, type: blob.type || "audio/webm", data, size: blob.size, duration },
      };
      current.current.setChats((items) =>
        appendMessage(items, targetId, message, "🎤 Голосовое сообщение", time),
      );
      current.current.setRecordingSeconds(0);
      return;
    }
    const owner = current.current.accountId;
    if (
      (await enqueue([new File([blob], name, { type: blob.type || "audio/webm" })], {
        voice: { duration, waveform: [] },
      })) &&
      current.current.accountId === owner
    )
      current.current.setRecordingSeconds(0);
  }
  return {
    uploadProgress,
    setUploadProgress,
    failedUploads,
    fileInputRef,
    handleAttachment,
    dismissFailedUpload,
    retryFailedUpload,
    sendVoiceMessage,
  };
}
