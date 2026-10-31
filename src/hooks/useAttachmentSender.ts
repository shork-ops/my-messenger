/**
 * Sending files into a conversation.
 *
 * Attachments are the most failure-prone part of a messenger, and every failure has to end in a
 * conversation with no half-sent album: a group of photos is uploaded, published and appended
 * together, or not at all. That rule is why this is one module rather than calls scattered
 * through the composer - the upload, the rollback and the "try again" shelf are one decision.
 *
 * The hook takes what it needs explicitly: the account, the open conversation, a way to write
 * into the chat list and a way to say something went wrong.
 */

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Attachment, Chat, Message } from "../types";
import { supabase } from "../lib/supabase";
import {
  MAX_UPLOAD_BYTES,
  buildStoragePath,
  formatBytes,
  isSupportedFile,
  prepareImage,
  shouldCompress,
} from "../lib/media";
import { splitIntoAlbums } from "../lib/albums";
import { addPending, removePending, type PendingAttachment } from "../lib/retryQueue";
import { appendMessage } from "../lib/chats";
import { clockTime, numericId } from "../lib/format";
import { viewOnceReady } from "../lib/viewOnceCloud";
import { analyseWaveform } from "../lib/voice";
import { blobToDataUrl } from "../lib/media";
import { SIGNED_URL_TTL_SECONDS } from "../lib/messageSync";

export type UploadProgress = { name: string; percent: number; stage: string };

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
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [failedUploads, setFailedUploads] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function dismissFailedUpload(key: string) {
    setFailedUploads((current) => removePending(current, key));
  }

  async function retryFailedUpload(entry: PendingAttachment) {
    setFailedUploads((current) => removePending(current, entry.key));
    const transfer = new DataTransfer();
    transfer.items.add(entry.file);
    // The upload path reads the chosen files from an input event, so the retry goes through
    // the same door rather than a second copy of the same logic that could drift.
    const input = fileInputRef.current;
    if (!input) {
      deps.notify("Повторить не удалось: поле выбора файла недоступно");
      return;
    }
    Object.defineProperty(input, "files", { value: transfer.files, configurable: true });
    if (entry.viewOnce) input.dataset.viewOnce = "true";
    await handleAttachment({ target: input } as unknown as ChangeEvent<HTMLInputElement>, {
      viewOnce: entry.viewOnce,
    });
  }

  async function uploadPicture(
    client: NonNullable<typeof supabase>,
    chatRemoteId: string,
    ownerId: string,
    file: File,
    percentFrom: number,
    percentTo: number,
    viewOnce = false,
  ): Promise<{ meta: Attachment; path: string } | null> {
    let payload: Blob = file;
    let uploadName = file.name;
    const base = { name: file.name, type: file.type || "application/octet-stream", size: file.size };
    let meta: Omit<Attachment, "data"> = base;

    if (shouldCompress(file)) {
      setUploadProgress({ name: file.name, percent: percentFrom, stage: "Сжимаю фото…" });
      const prepared = await prepareImage(file);
      payload = prepared.blob;
      uploadName = prepared.fileName;
      meta = {
        name: prepared.fileName,
        type: prepared.blob.type || file.type,
        size: prepared.blob.size,
        width: prepared.width || undefined,
        height: prepared.height || undefined,
        thumbnail: prepared.thumbnail || undefined,
      };
    }

    setUploadProgress({ name: uploadName, percent: Math.round((percentFrom + percentTo) / 2), stage: "Отправляю файл…" });
    const path = buildStoragePath(chatRemoteId, ownerId, uploadName, crypto.randomUUID());
    const bucket = viewOnce ? "view-once-media" : "chat-media";
    const uploaded = await client.storage.from(bucket).upload(path, payload, { contentType: meta.type, cacheControl: viewOnce ? "0" : "3600" });
    if (uploaded.error) return null;
    if (viewOnce) {
      const { thumbnail: _preview, ...safe } = meta;
      return { meta: { ...safe, path, data: "", viewOnce: true, bucket: "view-once-media" }, path };
    }
    const signed = await client.storage.from("chat-media").createSignedUrl(path, 3600);
    if (signed.error || !signed.data?.signedUrl) {
      // A stored file whose message is never written is an orphan; remove it rather than
      // leave the bucket to grow with files nobody can reach.
      await client.storage.from("chat-media").remove([path]);
      return null;
    }
    return {
      meta: {
        ...meta,
        path,
        data: signed.data.signedUrl,
        expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
        // The marker rides along with the attachment, so it survives every path that already
        // knows how to store one and needs no migration.
        ...(viewOnce ? { viewOnce: true } : {}),
      },
      path,
    };
  }

  async function handleAttachment(event: ChangeEvent<HTMLInputElement>, options: { viewOnce?: boolean } = {}) {
    const chosen = Array.from(event.target.files ?? []);
    // The composer sets this just before opening the picker for "look once"; reading it from the
    // input keeps one file picker rather than two that drift apart.
    const viewOnce = options.viewOnce ?? event.target.dataset.viewOnce === "true";
    delete event.target.dataset.viewOnce;
    event.target.value = "";
    if (chosen.length === 0) return;
    const chat = deps.chats.find((item) => item.id === deps.activeChatId);
    const client = supabase;
    if (!client || !deps.accountId || !chat?.remoteId) {
      deps.notify("Открой облачный диалог, чтобы отправить файл");
      return;
    }

    if (viewOnce && (!chosen[0].type.startsWith("image/") || !await viewOnceReady())) {
      deps.notify("Одноразовые фото пока недоступны: требуется серверное обновление. Обычные вложения работают.");
      return;
    }
    // Every file is checked before anything is uploaded: a selection that fails halfway
    // would leave half an album in the bucket and half in the conversation.
    for (const file of chosen) {
      if (file.size > MAX_UPLOAD_BYTES) {
        deps.notify(`Файл «${file.name}» больше ${formatBytes(MAX_UPLOAD_BYTES)}`);
        return;
      }
      if (!isSupportedFile(file.type)) {
        deps.notify(`Формат файла «${file.name}» пока не поддерживается`);
        return;
      }
    }

    // A photo meant to be seen once is one photo, never part of an album: the promise is about
    // that picture, and an album of nine others would leave the rest readable.
    const albums = viewOnce ? [chosen.slice(0, 1)] : splitIntoAlbums(chosen);
    if (viewOnce && chosen.length > 1) {
      deps.notify("Для фото «посмотреть один раз» можно выбрать одно фото");
    }
    let sent = 0;
    for (const group of albums) {
      const pictures: Attachment[] = [];
      const stored: Omit<Attachment, "data">[] = [];
      const paths: string[] = [];
      let failed = false;
      for (const [index, file] of group.entries()) {
        const from = 10 + Math.round((index / group.length) * 70);
        const to = 10 + Math.round(((index + 1) / group.length) * 70);
        const uploaded = await uploadPicture(client, chat.remoteId, deps.accountId, file, from, to, viewOnce);
        if (!uploaded) {
          failed = true;
          break;
        }
        pictures.push(uploaded.meta);
        const { data: _url, ...withoutUrl } = uploaded.meta;
        stored.push(withoutUrl);
        paths.push(uploaded.path);
      }
      if (failed) {
        // Nothing half-sent: the whole group is undone, or the conversation would show a
        // message that is missing the picture the person meant to send.
        await client.storage.from(viewOnce ? "view-once-media" : "chat-media").remove(paths);
        setUploadProgress(null);
        // Keep the files so "try again" does not mean "find the file again".
        const reason = "Не удалось загрузить файл. Проверь миграцию online_media в Supabase.";
        setFailedUploads((current) =>
          group.reduce(
            (list, item) =>
              addPending(list, {
                key: `${chat.remoteId}:${item.name}:${item.size}:${item.lastModified}`,
                file: item,
                chatId: deps.activeChatId,
                viewOnce,
                reason,
              }),
            current
          )
        );
        deps.notify(reason);
        return;
      }

      setUploadProgress({ name: group[0].name, percent: 85, stage: "Публикую сообщение…" });
      const first = pictures[0];
      const isAlbum = pictures.length > 1;
      const body = isAlbum ? `${pictures.length} фото` : first.name;
      const attachmentValue = isAlbum ? { items: stored } : stored[0];
      const inserted = await client
        .from("messages")
        .insert({ chat_id: chat.remoteId, sender_id: deps.accountId, body, attachment: attachmentValue })
        .select("id, created_at")
        .single();
      if (inserted.error || !inserted.data) {
        await client.storage.from(viewOnce ? "view-once-media" : "chat-media").remove(paths);
        setUploadProgress(null);
        deps.notify("Не удалось отправить вложение");
        return;
      }
      const row = inserted.data;
      const created = new Date(row.created_at);
      const message: Message = {
        id: numericId(row.id),
        remoteId: row.id,
        author: deps.profileName,
        text: body,
        time: clockTime(created),
        mine: true,
        createdAt: created.getTime(),
        ...(isAlbum ? { album: pictures } : { attachment: first }),
      };
      deps.setChats((current) =>
        appendMessage(current, deps.activeChatId, message, isAlbum ? `${pictures.length} фото` : "📎 " + first.name, message.time)
      );
      sent += isAlbum ? pictures.length : 1;
    }

    setUploadProgress({ name: chosen[0].name, percent: 100, stage: "Готово" });
    window.setTimeout(() => setUploadProgress(null), 900);
    deps.notify(sent === 1 ? "Вложение отправлено" : `Отправлено: ${sent}`);
  }

  async function sendVoiceMessage(blob: Blob) {
    const duration = Math.max(1, Math.round((Date.now() - (deps.recordingStartedRef.current || Date.now())) / 1000));
    const time = clockTime();
    const createdAt = Date.now();
    const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
    const fileName = `voice-${createdAt}.${extension}`;
    const chat = deps.chats.find((item) => item.id === deps.activeChatId);
    const client = supabase;

    // A local-only chat has nowhere to upload to; keep an inline copy so the
    // bubble still plays back in this session.
    if (!chat?.remoteId || !client || !deps.accountId) {
      const data = await blobToDataUrl(blob);
      const message: Message = {
        id: createdAt,
        author: deps.profileName,
        text: `Голосовое сообщение · ${duration} сек.`,
        time,
        mine: true,
        createdAt,
        attachment: { name: fileName, type: blob.type || "audio/webm", data, size: blob.size, duration },
      };
      deps.setChats((current) => appendMessage(current, deps.activeChatId, message, "🎤 Голосовое сообщение", time));
      deps.setRecordingSeconds(0);
      deps.notify("Голосовое сообщение добавлено в этот браузер");
      return;
    }

    setUploadProgress({ name: fileName, percent: 30, stage: "Отправляю голосовое…" });
    const path = buildStoragePath(chat.remoteId, deps.accountId, fileName, crypto.randomUUID());
    const uploaded = await client.storage.from("chat-media").upload(path, blob, { contentType: blob.type || "audio/webm" });
    if (uploaded.error) {
      setUploadProgress(null);
      deps.notify("Не удалось загрузить голосовое сообщение");
      return;
    }

    const waveform = await analyseWaveform(blob);
    setUploadProgress({ name: fileName, percent: 70, stage: "Публикую сообщение…" });
    const signed = await client.storage.from("chat-media").createSignedUrl(path, 3600);
    const meta = {
      name: fileName,
      type: blob.type || "audio/webm",
      size: blob.size,
      path,
      duration,
      waveform,
    };
    const inserted = await client
      .from("messages")
      .insert({ chat_id: chat.remoteId, sender_id: deps.accountId, body: `Голосовое сообщение · ${duration} сек.`, attachment: meta })
      .select("id, created_at")
      .single();
    if (inserted.error || !inserted.data) {
      await client.storage.from("chat-media").remove([path]);
      setUploadProgress(null);
      deps.notify("Не удалось отправить голосовое сообщение");
      return;
    }

    const row = inserted.data;
    const created = new Date(row.created_at);
    const message: Message = {
      id: numericId(row.id),
      remoteId: row.id,
      author: deps.profileName,
      text: `Голосовое сообщение · ${duration} сек.`,
      time: clockTime(created),
      mine: true,
      createdAt: created.getTime(),
      attachment: {
        ...meta,
        data: signed.data?.signedUrl ?? "",
        expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      },
    };
    deps.setChats((current) => appendMessage(current, deps.activeChatId, message, "🎤 Голосовое сообщение", message.time));
    setUploadProgress(null);
    deps.setRecordingSeconds(0);
    deps.notify("Голосовое сообщение отправлено");
  }

  return { uploadProgress, setUploadProgress, failedUploads, fileInputRef, handleAttachment, dismissFailedUpload, retryFailedUpload, sendVoiceMessage };
}
