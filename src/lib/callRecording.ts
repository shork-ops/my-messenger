/**
 * Recording a call.
 *
 * The recording happens entirely on the device: the browser's own `MediaRecorder` takes the
 * local microphone and camera, and the file is handed to the person who pressed the button.
 * Nothing is uploaded, and nobody else on the call is told about it by the server.
 *
 * That last sentence is the reason this file starts with a rule rather than a helper. In many
 * places recording a call without saying so is a crime, and a button that quietly records other
 * people is a feature that gets the app into trouble. So the interface says, in words, that
 * everyone on the call should know - and the call surface stays on screen while recording, so a
 * shared screen shows the indicator too.
 */

/** What the browser can actually produce, in order of preference. */
export const RECORDING_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

/** The file extension that matches what was chosen. */
export function recordingExtension(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

/**
 * The first type this browser will record, or null when it will not record at all.
 *
 * Asked rather than assumed: Safari historically refused webm, and a recorder built with an
 * unsupported type throws only when the first chunk is produced - after the call has started,
 * which is the worst moment to find out.
 */
export function pickRecordingMime(supported: (mime: string) => boolean): string | null {
  for (const candidate of RECORDING_MIME_CANDIDATES) {
    if (supported(candidate)) return candidate;
  }
  return null;
}

/** "Запись звонка · 01:23" - the label under the indicator. */
export function recordingLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `Запись · ${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * The name of the saved file.
 *
 * Named after the conversation and the moment, because a downloaded file called `recording`
 * is one nobody can find again.
 */
export function recordingFileName(chatName: string, startedAt: number): string {
  const date = new Date(startedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  const safe = chatName.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 40) || "звонок";
  return `Звонок ${safe} ${stamp}.webm`;
}

/**
 * What the person is told before recording starts.
 *
 * Not a checkbox and not a buried setting: a sentence that says what will happen and who should
 * know about it.
 */
export function recordingNotice(): string {
  return "Запись идёт на этом устройстве. Предупредите участников: они должны знать, что разговор записывают.";
}

/** The reason to refuse recording, or null when it is fine to start. */
export function recordingBlocker(state: {
  inCall: boolean;
  alreadyRecording: boolean;
  supported: boolean;
}): string | null {
  if (!state.inCall) return "Записать можно только идущий звонок";
  if (state.alreadyRecording) return "Запись уже идёт";
  if (!state.supported) return "Этот браузер не умеет записывать звук";
  return null;
}

/**
 * How large a recording is likely to be, in bytes.
 *
 * Shown while recording, because a long call fills a disk quietly. The rate is the default
 * `MediaRecorder` video bitrate with audio added, rounded up: the number is a warning, not an
 * accounting entry, and under-reporting it would be the worse error.
 */
export function estimatedRecordingBytes(seconds: number, video: boolean): number {
  const bytesPerSecond = video ? 1_250_000 : 32_000;
  return Math.max(0, Math.floor(seconds)) * bytesPerSecond;
}

/** "≈ 12 МБ" - a size a person can judge. */
export function formatRecordingSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `≈ ${Math.round(bytes / 1024)} КБ`;
  return `≈ ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} МБ`;
}
