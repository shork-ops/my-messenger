import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { formatNoteTime } from "../lib/videoNote";
import type { Attachment } from "../types";
import "../styles/video-note.css";

type VideoNotePlayerProps = {
  attachment: Attachment;
};

/**
 * A round video note, drawn the way Telegram draws one: a circle with the first frame, a
 * play mark and the length. A tap plays it with sound inside the same circle, and a ring
 * around the edge shows how much is left; another tap pauses.
 *
 * Loaded on demand: most conversations have no notes, so the first screen does not pay for it.
 */
export default function VideoNotePlayer({ attachment }: VideoNotePlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(attachment.duration ?? 0);
  const progress = length > 0 ? Math.min(1, position / length) : 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setPosition(video.currentTime);
    // A recording straight from MediaRecorder often reports an infinite duration; the length
    // stored when it was sent is kept in that case.
    const onMeta = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setLength(video.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
      video.currentTime = 0;
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("ended", onEnd);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("ended", onEnd);
    };
  }, []);

  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
      return;
    }
    try {
      video.muted = false;
      await video.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  // "#t=0.1" asks the browser to paint the first frame; without it iOS shows a black circle.
  const source = attachment.data.startsWith("http") ? `${attachment.data}#t=0.1` : attachment.data;
  const shown = formatNoteTime((playing || position > 0 ? position : length) * 1000);

  return (
    <button
      type="button"
      className={playing ? "video-note playing" : "video-note"}
      onClick={() => void toggle()}
      aria-label={playing ? "Пауза" : `Воспроизвести видеозаметку, ${formatNoteTime(length * 1000)}`}
    >
      <video ref={videoRef} src={source} playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
      <svg className="video-note-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48.5" pathLength={100} style={{ strokeDashoffset: 100 - progress * 100 }} />
      </svg>
      {!playing && (
        <span className="video-note-play" aria-hidden="true">
          <Play size={22} />
        </span>
      )}
      <span className="video-note-time" aria-hidden="true">
        {shown}
      </span>
    </button>
  );
}
