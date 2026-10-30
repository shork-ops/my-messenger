import { useCallback, useEffect, useRef, useState } from "react";
import {
  estimatedRecordingBytes,
  pickRecordingMime,
  recordingBlocker,
  recordingFileName,
} from "../lib/callRecording";

/**
 * Recording the local side of a call with `MediaRecorder`.
 *
 * The recording is of this device's own microphone and camera, which is what a browser can
 * actually do without a server. That means a call recording holds your voice clearly and the
 * other person only as well as your microphone heard them - worth saying in the interface
 * rather than promising a studio mix.
 *
 * The file is handed to the person who pressed the button. Nothing is uploaded.
 */
export function useCallRecording(chatName: string) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  // Asked once, before anyone presses anything: finding out the browser refuses at the moment
  // of pressing the button on a call in progress is the worst possible time.
  useEffect(() => {
    const supported = typeof MediaRecorder !== "undefined";
    setUnsupported(!supported || pickRecordingMime((mime) => MediaRecorder.isTypeSupported(mime)) === null);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  const save = useCallback(
    (blob: Blob) => {
      if (blob.size === 0) {
        setError("Запись пустая: звук не дошёл до браузера");
        return;
      }
      const name = recordingFileName(chatName, startedAtRef.current || Date.now());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      // Revoking straight away cancels the download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setLastSaved(name);
    },
    [chatName]
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    stopTimer();
    setRecording(false);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    // The stream is the microphone itself: leaving it live after the button says stopped would
    // keep the recording light on.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [stopTimer]);

  const start = useCallback(async () => {
    setError(null);
    const mime = typeof MediaRecorder === "undefined" ? null : pickRecordingMime((type) => MediaRecorder.isTypeSupported(type));
    const blocker = recordingBlocker({ inCall: true, alreadyRecording: recording, supported: mime !== null });
    if (blocker) {
      setError(blocker);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      const recorder = new MediaRecorder(stream, { mimeType: mime as string });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime as string });
        chunksRef.current = [];
        save(blob);
      };
      recorder.onerror = () => setError("Запись прервалась: браузер отказал");
      recorder.start(1000);
      setSeconds(0);
      setRecording(true);
      stopTimer();
      timerRef.current = window.setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    } catch {
      // Refusing the microphone is a decision, not a failure to hide in a console.
      setError("Нет доступа к микрофону: без него записать нечего");
      setRecording(false);
    }
  }, [recording, save, stopTimer]);

  /** The warning shown before recording, including a size estimate that grows with the call. */
  const sizeWarning = estimatedRecordingBytes(seconds, false);

  return { recording, seconds, error, unsupported, lastSaved, sizeWarning, start, stop };
}
