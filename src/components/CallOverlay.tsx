import { useEffect, useState } from "react";
import { Phone, PhoneOff, Video, Mic, MicOff, VideoOff } from "lucide-react";
import { formatCallDuration, presentCall, type ActiveCall } from "../lib/calls";

type CallOverlayProps = {
  call: ActiveCall | null;
  chatName: string;
  chatColor: string;
  /** Why the last call attempt failed, if it did. */
  error: string | null;
  /** Set once the SFU reports the call is connected; until then we are ringing. */
  connected: boolean;
  onAnswer: () => void;
  onDecline: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  muted: boolean;
  cameraOff: boolean;
  /** Receives the element the remote camera stream is attached to. */
  onRemoteVideo: (element: HTMLVideoElement | null) => void;
};

/**
 * Full-screen call surface for all three live stages: outgoing, incoming and
 * in-call.
 *
 * The stage is derived by `presentCall`, not by a local flag, so the caller can
 * never be shown an "answer" button for their own call.
 */
export function CallOverlay({
  call,
  chatName,
  chatColor,
  error,
  connected,
  onAnswer,
  onDecline,
  onHangUp,
  onToggleMute,
  onToggleCamera,
  muted,
  cameraOff,
  onRemoteVideo,
}: CallOverlayProps) {
  const [now, setNow] = useState(() => Date.now());
  const stage = presentCall(call);

  // The elapsed timer only needs to tick while the call is up.
  useEffect(() => {
    if (stage !== "incall") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (stage === "hidden") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (stage === "incoming") onDecline();
        else onHangUp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, onDecline, onHangUp]);

  if (!call || stage === "hidden") return null;

  const isVideo = call.kind === "video";
  const title = stage === "incoming" ? `Входящий ${isVideo ? "видеозвонок" : "звонок"}` : chatName;
  const subtitle =
    stage === "outgoing"
      ? "Вызов…"
      : stage === "incoming"
        ? chatName
        : connected && call.startedAt
          ? formatCallDuration(now - call.startedAt)
          : "Соединение…";

  return (
    <div className="call-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="call-card">
        {/* Video replaces the avatar once the peer's camera track arrives; an
            empty <video> is harmless while audio-only. */}
        <video
          ref={onRemoteVideo}
          className="call-video"
          autoPlay
          playsInline
          hidden={!isVideo || stage !== "incall"}
        />
        <div className={`call-avatar ${chatColor}`} aria-hidden="true" hidden={isVideo && stage === "incall"}>
          {chatName.slice(0, 1).toUpperCase()}
        </div>
        <div className="call-title">{title}</div>
        <div className="call-subtitle">{subtitle}</div>
        {error ? <div className="call-error">{error}</div> : null}

        {stage === "incoming" ? (
          <div className="call-actions">
            <button className="call-button decline" onClick={onDecline} aria-label="Отклонить">
              <PhoneOff size={22} />
            </button>
            <button className="call-button accept" onClick={onAnswer} aria-label="Ответить">
              <Phone size={22} />
            </button>
          </div>
        ) : (
          <>
            <div className="call-actions">
              <button
                className={`call-button ${muted ? "active" : ""}`}
                onClick={onToggleMute}
                aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
                aria-pressed={muted}
              >
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              {isVideo ? (
                <button
                  className={`call-button ${cameraOff ? "active" : ""}`}
                  onClick={onToggleCamera}
                  aria-label={cameraOff ? "Включить камеру" : "Выключить камеру"}
                  aria-pressed={cameraOff}
                >
                  {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
                </button>
              ) : null}
              <button className="call-button decline" onClick={onHangUp} aria-label="Завершить">
                <PhoneOff size={22} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

