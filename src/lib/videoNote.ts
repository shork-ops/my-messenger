/**
 * Video notes: a short round video recorded in the composer.
 *
 * The round shape is not decoration: it tells the reader the clip is a few seconds
 * long before they tap it, which is the difference between watching and skipping.
 */

/** A note longer than this is a video message, not a note. */
export const VIDEO_NOTE_MAX_MS = 60_000;

/** Older than this and a note arrives as a surprise. */
export const VIDEO_NOTE_WARN_MS = 45_000;

/** The video size a note is recorded at, square so the circle crops nothing. */
export const NOTE_SIZE = 480;

/**
 * What to ask the camera for.
 *
 * These used to be bare numbers, which the browser reads as an exact requirement: a
 * camera that cannot produce 480 by 480 refuses outright with `OverconstrainedError`,
 * and the recorder reported that refusal as "no access to the camera, allow it in your
 * browser" - advice that could never help, because the permission was never the problem.
 * `ideal` asks for this size and accepts the closest one instead.
 */
export function noteCameraConstraints(): MediaTrackConstraints {
  return { width: { ideal: NOTE_SIZE }, height: { ideal: NOTE_SIZE } };
}

export const NOTE_BITRATE = 900_000;

/** Progress through the maximum, for the ring around the recording button. */
export function noteProgress(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(1, elapsedMs / VIDEO_NOTE_MAX_MS);
}

/** "0:07" for the recording timer. */
export function formatNoteTime(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const total = Math.floor(safe / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Whether the note is long enough to be worth sending. */
export function isSendableNote(ms: number): boolean {
  return ms >= 800;
}

/**
 * The media recorder options for a note.
 *
 * Chosen by what the browser actually supports rather than by preference: Safari
 * has no webm encoder, and asking for one there produces a recorder that fails on
 * the first frame.
 */
export function noteRecorderOptions(supportsWebm: boolean): MediaRecorderOptions {
  if (supportsWebm) {
    return { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: NOTE_BITRATE };
  }
  return { mimeType: "video/mp4", videoBitsPerSecond: NOTE_BITRATE };
}

/** What the note's bubble says about its length. */
export function noteDurationLabel(ms: number): string {
  return formatNoteTime(ms);
}

/** The file name a note is stored under, so a download is recognisable. */
export function noteFileName(ms: number, extension: string): string {
  return `video-note-${Math.round(ms / 1000)}s.${extension}`;
}

/**
 * Why the camera would not open, said in a way the reader can act on.
 *
 * Every failure used to be reported as "allow the camera in your browser", which sent
 * people who had already allowed it to look for a setting that was not the problem: a
 * busy camera, an absent one and an unsupported frame size all received the same advice.
 */
export function noteCameraError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Камера запрещена в браузере. Разрешите доступ и нажмите «Попробовать снова»";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Камера не найдена. Подключите её и нажмите «Попробовать снова»";
  }
  // The camera exists and the permission is fine, but the frame size could not be met.
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "Камера не поддерживает нужный размер кадра. Попробуйте снова";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Камера занята другим приложением. Закройте его и попробуйте снова";
  }
  if (name === "AbortError") return "Камера не успела запуститься. Попробуйте снова";
  return "Не удалось открыть камеру. Попробуйте снова";
}

/** Whether the camera can be asked again after this failure, rather than only explained. */
export function canRetryCamera(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  // A refusal needs the person to change a setting first; everything else is worth another try.
  return name !== "NotAllowedError" && name !== "PermissionDeniedError" && name !== "SecurityError";
}
