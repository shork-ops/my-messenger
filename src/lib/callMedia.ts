import { Room, RoomEvent, Track } from "livekit-client";
import type { CallToken } from "./calls";

/**
 * Thin wrapper over a LiveKit room.
 *
 * Kept separate from React so the connection lifecycle has one owner and can be
 * reasoned about: connect once, publish, toggle, disconnect. The hook only reads
 * the resulting state.
 */

export type MediaState = {
  connected: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  /** Set when the browser refused a device or the connection dropped. */
  error: string | null;
};

const INITIAL_MEDIA: MediaState = {
  connected: false,
  micEnabled: false,
  cameraEnabled: false,
  error: null,
};

type MediaListeners = {
  onState: (state: MediaState) => void;
  onRemoteVideo: (track: Track | null) => void;
};

/**
 * Turns a browser media error into something a person can act on.
 *
 * `NotAllowedError` is the common case and its default message ("Permission
 * denied") does not tell the user what to click.
 */
export function describeMediaError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Разрешите доступ к микрофону и камере в браузере";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Микрофон или камера не найдены";
  }
  if (name === "NotReadableError") return "Устройство занято другим приложением";
  return "Не удалось подключиться к звонку";
}

export class CallSession {
  private room: Room | null = null;
  private state: MediaState = INITIAL_MEDIA;
  private disposed = false;

  constructor(private readonly listeners: MediaListeners) {}

  private emit(patch: Partial<MediaState>) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.listeners.onState(this.state);
  }

  /** Connects to the SFU and starts publishing audio (and video when asked). */
  async connect(token: CallToken, options: { video: boolean }): Promise<void> {
    const room = new Room({
      // Echo cancellation and noise suppression matter more than raw quality in
      // a chat app: without them a laptop fan makes the call unusable.
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { resolution: { width: 1280, height: 720 } },
    });
    this.room = room;

    room
      .on(RoomEvent.ParticipantConnected, () => this.emit({}))
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video) this.listeners.onRemoteVideo(track);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Video) this.listeners.onRemoteVideo(null);
      })
      .on(RoomEvent.Disconnected, () => this.emit({ connected: false, micEnabled: false, cameraEnabled: false }));

    try {
      await room.connect(token.url, token.token, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      if (options.video) await room.localParticipant.setCameraEnabled(true);
      this.emit({
        connected: true,
        micEnabled: true,
        cameraEnabled: options.video,
      });
    } catch (error) {
      this.emit({ error: describeMediaError(error), connected: false });
      await this.dispose();
    }
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.room) return;
    // Failures here are recoverable (device unplugged); keep the room alive.
    await this.room.localParticipant.setMicrophoneEnabled(!muted).catch(() => undefined);
    this.emit({ micEnabled: !muted });
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setCameraEnabled(enabled).catch(() => undefined);
    this.emit({ cameraEnabled: enabled });
  }

  /** Leaves the room and releases the microphone light. */
  async dispose(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.disposed = true;
    this.listeners.onRemoteVideo(null);
    if (room) {
      await room.disconnect().catch(() => undefined);
      // Disconnecting leaves tracks attached; local tracks must be stopped or
      // the browser keeps the camera indicator on.
      room.localParticipant.getTrackPublications().forEach((publication) => {
        publication.track?.stop();
      });
    }
    this.listeners.onState({ ...INITIAL_MEDIA });
  }
}
