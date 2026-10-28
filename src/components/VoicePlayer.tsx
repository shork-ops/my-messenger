import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { decodeWaveform, formatDuration } from "../lib/voice";
import type { Attachment } from "../types";

type VoicePlayerProps = {
  attachment: Attachment;
};

/**
 * Audio player for voice messages.
 *
 * Bars are rendered from the peaks stored when the message was sent, and the
 * played portion is highlighted by clipping a second copy of the same bars, so
 * seeking works exactly like a native progress bar.
 */
export default function VoicePlayer({ attachment }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(attachment.duration ?? 0);
  const bars = decodeWaveform(attachment.waveform);
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPosition(audio.currentTime);
    const onMeta = () => {
      // The real duration wins once the browser knows it.
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  function seek(event: React.MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setPosition(audio.currentTime);
  }

  return (
    <div className="voice-player">
      <button type="button" className="voice-toggle" onClick={() => void toggle()} aria-label={playing ? "Пауза" : "Воспроизвести голосовое"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button
        type="button"
        className="voice-wave"
        onClick={seek}
        aria-label={`Перемотать: ${formatDuration(position)} из ${formatDuration(duration)}`}
      >
        <span className="voice-bars">
          {bars.map((height, index) => (
            <i key={index} style={{ height: `${Math.max(12, Math.round(height * 100))}%` }} />
          ))}
        </span>
        <span className="voice-bars voice-bars-played" style={{ clipPath: `inset(0 ${Math.round((1 - progress) * 100)}% 0 0)` }} aria-hidden="true">
          {bars.map((height, index) => (
            <i key={index} style={{ height: `${Math.max(12, Math.round(height * 100))}%` }} />
          ))}
        </span>
      </button>
      <span className="voice-time">{formatDuration(playing || position > 0 ? position : duration)}</span>
      <audio ref={audioRef} src={attachment.data} preload="metadata" />
      <a className="voice-download" href={attachment.data} download={attachment.name} aria-label="Скачать голосовое">
        Скачать
      </a>
    </div>
  );
}
