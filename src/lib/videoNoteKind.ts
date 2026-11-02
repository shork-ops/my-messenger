/**
 * What the conversation needs to know about video notes, without the recorder.
 *
 * Split from videoNote.ts so the first screen does not carry the camera code: the recorder is
 * loaded only when someone opens it, while every bubble has to tell a note from a video file.
 */

/** "0:07" for the recording timer. */
export function formatNoteTime(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const total = Math.floor(safe / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The name a note is stored under. The length is in it, and the extension matches what the
 * browser actually recorded: Safari records mp4, and a ".webm" name on an mp4 file confused
 * players that trust the extension.
 */
export function noteAttachmentName(ms: number, mimeType: string): string {
  return `Видеозаметка ${formatNoteTime(ms)}.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
}

/** Older notes carried only their name; the marker came later. Both mean "draw it round". */
const NOTE_NAME = /^Видеозаметка \d+:\d{2}\.(webm|mp4)$/;

/**
 * Whether an attachment is a round video note rather than an ordinary video file.
 *
 * Notes used to be stored as a plain video with a telling name, so the receiver drew them as
 * a rectangular player with controls - the same as any downloaded clip. The name is still
 * honoured, so the notes already sent turn round too.
 */
export function isVideoNote(attachment: { type: string; name: string; videoNote?: boolean } | null | undefined): boolean {
  if (!attachment || !attachment.type.startsWith("video/")) return false;
  return attachment.videoNote === true || NOTE_NAME.test(attachment.name);
}
