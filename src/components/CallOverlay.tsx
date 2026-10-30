import { useEffect, useState } from "react";
import { Phone, PhoneOff, Video, Mic, MicOff, VideoOff, ScreenShare, ScreenShareOff, Circle, Square } from "lucide-react";
import { formatCallDuration, presentCall, type ActiveCall } from "../lib/calls";
import { formatRecordingSize, recordingLabel, recordingNotice } from "../lib/callRecording";
import { freePlanNote } from "../lib/callPlan";
import {
  isGroupCall,
  participantInitial,
  participantLabel,
  pluralParticipants,
  type RoomParticipant,
} from "../lib/groupCall";

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
  screenSharing: boolean;
  onToggleScreenShare: () => void;
  muted: boolean;
  cameraOff: boolean;
  /** Receives the element the remote camera stream is attached to. */
  onRemoteVideo: (element: HTMLVideoElement | null) => void;
  /** The shared screen has its own element, so it never replaces the camera. */
  onRemoteScreen?: (element: HTMLVideoElement | null) => void;
  /** Everyone on the call, the local participant included. */
  participants: RoomParticipant[];
  /** Call recording, which happens on this device and nowhere else. */
  recording: {
    active: boolean;
    seconds: number;
    error: string | null;
    unsupported: boolean;
    onStart: () => void;
    onStop: () => void;
  };
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
  screenSharing,
  onToggleScreenShare,
  muted,
  cameraOff,
  onRemoteVideo,
  onRemoteScreen,
  participants,
  recording,
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
  // Once a third person joins, a single avatar no longer says who is there.
  const group = isGroupCall(participants);
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
          hidden={!isVideo || stage !== "incall" || group}
        />
        {/* A screen arriving during an audio call has to be visible, so this element does
            not depend on the call being a video call. It stays in the layout with no
            source until a screen track is published, and is emptied when the share ends,
            otherwise the last frame would sit there looking live. */}
        <video
          ref={onRemoteScreen}
          className="call-screen-video"
          autoPlay
          playsInline
          muted
          hidden={stage !== "incall" || group}
          aria-label="Экран собеседника"
        />
        <div className={`call-avatar ${chatColor}`} aria-hidden="true" hidden={(isVideo && stage === "incall") || group}>
          {chatName.slice(0, 1).toUpperCase()}
        </div>
        {group && stage === "incall" ? (
          <div className="call-people" role="list" aria-label="Участники звонка">
            {participants.map((participant) => (
              <div key={participant.identity} className="call-person" role="listitem">
                <span className={`call-person-avatar ${chatColor}`} aria-hidden="true">
                  {participantInitial(participant.name)}
                </span>
                <span className="call-person-name">{participantLabel(participant)}</span>
                {participant.muted ? <span className="call-person-muted">без звука</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {group && stage === "incall" && freePlanNote() ? (
          <p className="call-plan-note">{freePlanNote()}</p>
        ) : null}
        <div className="call-title">{title}</div>
        <div className="call-subtitle">
          {group && stage === "incall" ? pluralParticipants(participants.length) : subtitle}
        </div>
        {error ? <div className="call-error">{error}</div> : null}
        {recording.active ? (
          <div className="call-recording" role="status" aria-live="polite">
            <span className="call-recording-dot" aria-hidden="true" />
            {recordingLabel(recording.seconds)} · {formatRecordingSize(recording.seconds * 32_000)}
          </div>
        ) : null}
        {recording.error ? <div className="call-error">{recording.error}</div> : null}

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
              <button
                className={`call-button ${screenSharing ? "active" : ""}`}
                onClick={onToggleScreenShare}
                aria-label={screenSharing ? "Остановить показ экрана" : "Показать экран"}
                aria-pressed={screenSharing}
              >
                {screenSharing ? <ScreenShareOff size={22} /> : <ScreenShare size={22} />}
              </button>
              {stage === "incall" && !recording.unsupported ? (
                <button
                  className={`call-button ${recording.active ? "active" : ""}`}
                  onClick={recording.active ? recording.onStop : recording.onStart}
                  aria-label={recording.active ? "Остановить запись" : "Записать звонок"}
                  aria-pressed={recording.active}
                  title={recordingNotice()}
                >
                  {recording.active ? <Square size={20} /> : <Circle size={20} />}
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

