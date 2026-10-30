import type { Room, Track } from "livekit-client";
import type { CallToken } from "./calls";
import type { RoomParticipant } from "./groupCall";
import { screenShareRequest, shareErrorMessage } from "./screenShare";

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
  /**
   * Everyone currently in the room, the local participant included.
   *
   * Read from the room rather than counted locally: people leave by closing the tab
   * as often as by pressing hang up, and only the SFU knows about that.
   */
  participants: RoomParticipant[];
  /** Whether the local participant is sharing their screen. */
  screenSharing: boolean;
};

/** The publication name that marks a screen track, on both the sending and receiving side. */
export const SCREEN_TRACK_NAME = "screen";

/**
 * Which element a remote video track belongs in.
 *
 * Camera and screen are both video tracks and were fed to one element, so a shared screen
 * replaced the peer's face and the receiving side could not tell which it was looking at.
 * The publisher names the screen track, and that name is the only thing that survives the
 * trip through the SFU.
 */
export function isScreenTrack(name: string | undefined): boolean {
  return name === SCREEN_TRACK_NAME;
}

const INITIAL_MEDIA: MediaState = {
  connected: false,
  micEnabled: false,
  cameraEnabled: false,
  error: null,
  participants: [],
  screenSharing: false,
};

/** Reads the room's people into the shape the call screen renders. */
function readParticipants(room: Room): RoomParticipant[] {
  const local = room.localParticipant;
  const everyone = [local, ...room.remoteParticipants.values()];
  return everyone.map((participant) => ({
    identity: participant.identity,
    name: participant.name || participant.identity,
    // An un-muted participant is publishing audio; a camera-only one is not muted.
    muted: participant.isMicrophoneEnabled === false,
  }));
}

type MediaListeners = {
  onState: (state: MediaState) => void;
  onRemoteVideo: (track: Track | null) => void;
  /** A shared screen, kept apart from the camera so both can be shown at once. */
  onRemoteScreen: (track: Track | null) => void;
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

/**
 * The LiveKit SDK is loaded on the first call, not at import time.
 *
 * It is the largest dependency in the app and most sessions end without a call, so
 * fetching it at startup made every visitor pay for a feature they did not use. The
 * module is cached by the bundler after the first load, so a second call is instant.
 */
let livekitLoading: Promise<typeof import("livekit-client")> | null = null;

function loadLiveKit(): Promise<typeof import("livekit-client")> {
  // The promise is cached, not the result: two calls started at the same moment share
  // one download instead of racing for it.
  livekitLoading ??= import("livekit-client");
  return livekitLoading;
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
    const { Room, RoomEvent, Track } = await loadLiveKit();
    const room = new Room({
      // Echo cancellation and noise suppression matter more than raw quality in
      // a chat app: without them a laptop fan makes the call unusable.
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { resolution: { width: 1280, height: 720 } },
    });
    this.room = room;

    const publishParticipants = () => this.emit({ participants: readParticipants(room) });

    room
      .on(RoomEvent.ParticipantConnected, publishParticipants)
      .on(RoomEvent.ParticipantDisconnected, publishParticipants)
      .on(RoomEvent.TrackMuted, publishParticipants)
      .on(RoomEvent.TrackUnmuted, publishParticipants)
      .on(RoomEvent.TrackSubscribed, (track, publication) => {
        if (track.kind !== Track.Kind.Video) return;
        // The publisher names the screen track "screen"; a camera track keeps the default
        // name, so the name is what tells the two apart on the receiving side.
        if (isScreenTrack(publication?.trackName)) this.listeners.onRemoteScreen(track);
        else this.listeners.onRemoteVideo(track);
      })
      .on(RoomEvent.TrackUnsubscribed, (track, publication) => {
        // Clearing the right element matters more than it looks: a screen track left
        // attached to its video element freezes on its last frame when the share ends,
        // which reads as if the other person were still showing their screen.
        if (track.kind !== Track.Kind.Video) return;
        if (isScreenTrack(publication?.trackName)) this.listeners.onRemoteScreen(null);
        else this.listeners.onRemoteVideo(null);
      })
      .on(RoomEvent.Disconnected, () => this.emit({ connected: false, micEnabled: false, cameraEnabled: false, screenSharing: false }));

    try {
      await room.connect(token.url, token.token, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      if (options.video) await room.localParticipant.setCameraEnabled(true);
      this.emit({
        connected: true,
        micEnabled: true,
        cameraEnabled: options.video,
        participants: readParticipants(room),
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
    this.emit({ micEnabled: !muted, participants: readParticipants(this.room) });
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setCameraEnabled(enabled).catch(() => undefined);
    this.emit({ cameraEnabled: enabled });
  }

  /**
   * Shares the screen, or stops sharing.
   *
   * The browser decides what can be shared, so the failure paths matter as much as the
   * success one: a person who cancelled the picker should not see an error, and a
   * share the browser stops on its own must clear the state here rather than leave a
   * frozen frame on the other side.
   */
  async setScreenShare(enabled: boolean): Promise<string | null> {
    if (!this.room) return null;
    const room = this.room;
    try {
      if (!enabled) {
        await room.localParticipant.setScreenShareEnabled(false);
        this.emit({ screenSharing: false });
        return null;
      }
      // The request is built here rather than by LiveKit's defaults so a shared
      // document stays sharp at a low frame rate instead of being resampled for video.
      const stream = await navigator.mediaDevices.getDisplayMedia(screenShareRequest() as DisplayMediaStreamOptions);
      const track = stream.getVideoTracks()[0];
      if (!track) return "Экран не выбран";
      track.addEventListener("ended", () => {
        // The browser's own "stop sharing" bar ends the track without telling us.
        void room.localParticipant.unpublishTrack(track).catch(() => undefined);
        this.emit({ screenSharing: false });
      });
      await room.localParticipant.publishTrack(track, { name: SCREEN_TRACK_NAME });
      this.emit({ screenSharing: true });
      return null;
    } catch (error) {
      const name = (error as { name?: string }).name ?? "";
      this.emit({ screenSharing: false });
      return shareErrorMessage(name);
    }
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
    this.listeners.onState({ ...INITIAL_MEDIA, participants: [] });
  }
}
