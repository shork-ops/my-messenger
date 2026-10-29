import { useEffect, useRef, useState } from "react";
import { Circle, Square, Trash2, Send } from "lucide-react";
import {
  NOTE_SIZE,
  VIDEO_NOTE_MAX_MS,
  VIDEO_NOTE_WARN_MS,
  formatNoteTime,
  isSendableNote,
  noteProgress,
  noteRecorderOptions,
} from "../lib/videoNote";

type VideoNoteRecorderProps = {
  onSend: (file: File, durationMs: number) => void;
  onClose: () => void;
};

/**
 * Records a video note from the camera.
 *
 * The camera stream is stopped the moment recording ends rather than when the sheet
 * closes: leaving it running keeps the indicator light on and looks, correctly, like
 * the app is still watching.
 */
export default function VideoNoteRecorder({ onSend, onClose }: VideoNoteRecorderProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; durationMs: number; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Open the camera, and release it on unmount whatever else happened.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: NOTE_SIZE, height: NOTE_SIZE }, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("Нет доступа к камере. Разреши её в настройках браузера."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const length = Date.now() - startedAtRef.current;
      setElapsed(length);
      // Stopping at the cap rather than rejecting afterwards: a note that is cut is
      // better than one that cannot be sent.
      if (length >= VIDEO_NOTE_MAX_MS) stopRecording();
    }, 200);
    return () => window.clearInterval(timer);
    // stopRecording is stable enough for this purpose; it reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) {
      setError("Камера ещё не готова");
      return;
    }
    const options = noteRecorderOptions(typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus"));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch {
      setError("Этот браузер не умеет записывать видео");
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const type = recorder.mimeType || options.mimeType || "video/webm";
      setResult({ blob: new Blob(chunksRef.current, { type }), durationMs, type });
      // Free the camera as soon as there is footage to send: stopping the tracks
      // is not enough while the element still points at the stream.
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    startedAtRef.current = Date.now();
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);
    setResult(null);
    setError(null);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function send() {
    if (!result) return;
    const extension = result.type.includes("mp4") ? "mp4" : "webm";
    const file = new File([result.blob], `video-note.${extension}`, { type: result.type.split(";")[0] });
    onSend(file, result.durationMs);
  }

  const progress = noteProgress(elapsed);

  return (
    <div className="note-recorder" role="dialog" aria-label="Видеозаметка">
      <video ref={videoRef} className="note-preview" autoPlay muted playsInline aria-label="Предпросмотр камеры" />
      {error ? <p className="note-error">{error}</p> : null}

      {result ? (
        <div className="note-actions">
          <span className="note-time">{formatNoteTime(result.durationMs)}</span>
          <button type="button" className="note-button" onClick={() => setResult(null)} aria-label="Перезаписать">
            <Trash2 size={18} />
          </button>
          <button type="button" className="note-button send" onClick={send} aria-label="Отправить заметку">
            <Send size={18} />
          </button>
          <button type="button" className="note-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
      ) : (
        <div className="note-actions">
          <span className="note-time" aria-live="polite">
            {recording ? formatNoteTime(elapsed) : "0:00"}
          </span>
          {recording ? (
            <button type="button" className="note-button stop" onClick={stopRecording} aria-label="Остановить запись">
              <Square size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="note-button record"
              onClick={startRecording}
              aria-label="Начать запись"
              disabled={Boolean(error)}
            >
              <Circle size={20} />
            </button>
          )}
          <button type="button" className="note-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
      )}

      {/* The ring says how much of the minute is left without a second number. */}
      <div className="note-ring" aria-hidden="true" style={{ ["--note-progress" as string]: String(progress) }} />
      {recording && elapsed >= VIDEO_NOTE_WARN_MS ? <p className="note-warn">Скоро закончится минута</p> : null}
      {result && !isSendableNote(result.durationMs) ? <p className="note-warn">Слишком короткая запись</p> : null}
    </div>
  );
}
