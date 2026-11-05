import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttachmentJob, PreparedFile } from "./attachmentOutbox";
import { saveAttachmentJobs } from "./attachmentOutbox";
import { buildStoragePath, prepareImage, shouldCompress } from "./media";
import type { ChatMessageRow } from "../types";

/** A response can be lost after commit: check the stable message ID before touching files. */
async function published(client: SupabaseClient, job: AttachmentJob): Promise<ChatMessageRow | null> {
  const { data, error } = await client
    .from("messages")
    .select("*")
    .eq("id", job.key)
    .eq("chat_id", job.remoteChatId)
    .eq("sender_id", job.owner)
    .maybeSingle();
  if (error) throw error;
  return data as ChatMessageRow | null;
}
export async function deliverAttachment(
  client: SupabaseClient,
  job: AttachmentJob,
  active: () => boolean,
  progress: (name: string, percent: number, stage: string) => void,
): Promise<ChatMessageRow> {
  const check = () => {
    if (!active()) throw new Error("Отправка остановлена");
  };
  check();
  const existing = await published(client, job);
  check();
  if (existing) return existing;
  if (!job.prepared) {
    const prepared: PreparedFile[] = [];
    for (const [index, file] of job.files.entries()) {
      check();
      progress(file.name, 5, "Подготавливаем файл…");
      const original = new File([file.blob], file.name, { type: file.type, lastModified: file.lastModified });
      const image = shouldCompress(original) ? await prepareImage(original) : null;
      check();
      const blob = image?.blob ?? file.blob,
        name = image?.fileName ?? file.name;
      const path = buildStoragePath(job.remoteChatId, job.owner, name, `${job.key}-${index}`);
      if (job.voice && !job.voice.waveform.length) {
        const { analyseWaveform } = await import("./voice");
        job.voice.waveform = await analyseWaveform(blob);
      }
      const meta = {
        name,
        type: blob.type || file.type || "application/octet-stream",
        size: blob.size,
        path,
        ...(image
          ? {
              width: image.width || undefined,
              height: image.height || undefined,
              ...(!job.viewOnce ? { thumbnail: image.thumbnail || undefined } : {}),
            }
          : {}),
        ...(job.viewOnce ? { viewOnce: true, bucket: "view-once-media" as const } : {}),
        ...(job.videoNoteMs !== undefined
          ? { videoNote: true, duration: Math.max(1, Math.round(job.videoNoteMs / 1000)) }
          : {}),
        ...(job.voice ?? {}),
      };
      prepared.push({ blob, path, meta });
    }
    // Persist the exact upload bytes and metadata before the first network write.
    job.prepared = prepared;
    try {
      await saveAttachmentJobs([job]);
    } catch (error) {
      delete job.prepared;
      throw error;
    }
  }
  const bucket = job.viewOnce ? "view-once-media" : "chat-media";
  for (const [index, file] of job.prepared.entries()) {
    check();
    progress(file.meta.name, 10 + Math.round((index / job.prepared.length) * 65), "Отправляем файл…");
    const { error } = await client.storage.from(bucket).upload(file.path, file.blob, {
      contentType: file.meta.type,
      cacheControl: job.viewOnce ? "0" : "3600",
      upsert: false,
    });
    if (error) {
      const code = String((error as { statusCode?: string | number }).statusCode ?? "");
      if (code !== "409" && !/already exists|duplicate/i.test(error.message)) throw error;
    }
  }
  check();
  progress(job.files[0].name, 85, "Публикуем сообщение…");
  const attachment =
    job.prepared.length > 1 ? { items: job.prepared.map((file) => file.meta) } : job.prepared[0].meta;
  const body =
    job.body ?? (job.prepared.length > 1 ? `${job.prepared.length} фото` : job.prepared[0].meta.name);
  const result = await client
    .from("messages")
    .insert({ id: job.key, chat_id: job.remoteChatId, sender_id: job.owner, body, attachment })
    .select("*")
    .single();
  if (!result.error && result.data) return result.data as ChatMessageRow;
  // Never delete uploaded paths here: the database may already reference them.
  const confirmed = await published(client, job);
  if (confirmed) return confirmed;
  throw result.error ?? new Error("Сервер не подтвердил отправку вложения");
}
