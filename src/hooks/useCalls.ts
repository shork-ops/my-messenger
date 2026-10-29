import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  answerCall as answerCallRpc,
  endCall as endCallRpc,
  isLive,
  startCall as startCallRpc,
  toActiveCall,
  type ActiveCall,
  type CallKind,
  type CallRow,
} from "../lib/calls";
import type { Message } from "../types";
import { CallSession, type MediaState } from "../lib/callMedia";
import { fetchCallToken } from "../lib/calls";

type UseCallsOptions = {
  accountId: string | null;
  /** Live calls are only tracked once a cloud account is signed in. */
  enabled: boolean;
  /** Announce the result of a call action in the existing notice line. */
  notify: (text: string) => void;
};

type UseCallsResult = {
  call: ActiveCall | null;
  starting: boolean;
  /** Resolves with the RPC error, if any, so the caller can render a reason. */
  startCall: (chatId: string, kind: CallKind) => Promise<{ error: string | null }>;
  answer: () => Promise<void>;
  hangUp: (outcome?: "ended" | "declined") => Promise<void>;
  /** Connection and device state of the current call. */
  media: MediaState;
  /** Remote participant's video element ref is filled by `attachRemoteVideo`. */
  attachRemoteVideo: (element: HTMLVideoElement | null) => void;
  toggleMute: () => Promise<void>;
  toggleCamera: () => Promise<void>;
};

/**
 * Tracks at most one live call for the signed-in user.
 *
 * Two delivery paths feed it: a realtime subscription (a call starting while the
 * app is open) and an explicit reload after any local action. Realtime alone is
 * not enough, because the caller starts the call through an RPC and must see
 * their own outgoing state immediately.
 */
const INITIAL_MEDIA_STATE: MediaState = {
  connected: false,
  micEnabled: false,
  cameraEnabled: false,
  error: null,
  participants: [],
};

export function useCalls({ accountId, enabled, notify }: UseCallsOptions): UseCallsResult {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [starting, setStarting] = useState(false);
  const [media, setMedia] = useState<MediaState>(INITIAL_MEDIA_STATE);
  // The SFU session lives outside React state: it owns sockets and media tracks,
  // which must not be recreated on every render.
  const sessionRef = useRef<CallSession | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteTrackRef = useRef<unknown>(null);
  // Realtime callbacks outlive individual renders, so the account id is read
  // through a ref rather than captured.
  const accountRef = useRef(accountId);
  accountRef.current = accountId;

  const adopt = useCallback((row: CallRow | null) => {
    const current = accountRef.current;
    if (!row || !current) {
      setCall(null);
      return;
    }
    setCall(isLive(row.status) ? toActiveCall(row, current) : null);
  }, []);

  /** Re-reads the live call for a chat, or for every chat when omitted. */
  const reload = useCallback(
    async (chatId?: string) => {
      const client = supabase;
      const current = accountRef.current;
      if (!client || !current) return;

      const { data: memberships } = await client.from("chat_members").select("chat_id").eq("user_id", current);
      const chatIds = (memberships ?? []).map((row) => row.chat_id as string);
      const scope = chatId ? chatIds.filter((id) => id === chatId) : chatIds;
      if (scope.length === 0) {
        setCall(null);
        return;
      }

      const { data } = await client
        .from("calls")
        .select("id, chat_id, created_by, kind, status, started_at, answered_at, ended_at, room_name")
        .in("chat_id", scope)
        .in("status", ["ringing", "active"])
        .order("started_at", { ascending: false })
        .limit(1);

      adopt((data?.[0] as CallRow | undefined) ?? null);
    },
    [adopt]
  );

  useEffect(() => {
    if (!enabled || !accountId || !supabase) {
      setCall(null);
      return;
    }

    void reload();

    // RLS already limits the stream to chats the user belongs to; the filter is
    // on the table itself so an insert row carries the data we need.
    const client = supabase;
    const channel = client
      .channel(`calls:${accountId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, (payload) => {
        const row = (payload.new ?? payload.old) as Partial<CallRow> | undefined;
        if (!row) return;
        // Any change can end the call we are showing, so re-read rather than
        // trying to reconcile statuses locally.
        void reload(row.chat_id);
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [enabled, accountId, reload]);

  const attachRemoteVideo = useCallback((element: HTMLVideoElement | null) => {
    remoteVideoRef.current = element;
    const track = remoteTrackRef.current as { attach?: (el: HTMLVideoElement) => void } | null;
    if (element && track?.attach) track.attach(element);
  }, []);

  /** Opens the SFU connection for a live call, if it is not open already. */
  const connectMedia = useCallback(
    async (target: ActiveCall) => {
      if (sessionRef.current) return;
      const token = await fetchCallToken(target.id);
      if (!token.data) {
        setMedia({ ...INITIAL_MEDIA_STATE, error: token.error ?? "Не удалось подключиться к звонку" });
        return;
      }
      const session = new CallSession({
        onState: (state) => setMedia(state),
        onRemoteVideo: (track) => {
          remoteTrackRef.current = track;
          if (track && remoteVideoRef.current) {
            (track as { attach?: (el: HTMLVideoElement) => void }).attach?.(remoteVideoRef.current);
          }
        },
      });
      sessionRef.current = session;
      await session.connect(token.data, { video: target.kind === "video" });
    },
    []
  );

  /** Tears the SFU connection down; safe to call when nothing is connected. */
  const closeMedia = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    remoteTrackRef.current = null;
    if (session) await session.dispose();
    setMedia(INITIAL_MEDIA_STATE);
  }, []);

  const toggleMute = useCallback(async () => {
    await sessionRef.current?.setMuted(media.micEnabled);
  }, [media.micEnabled]);

  const toggleCamera = useCallback(async () => {
    await sessionRef.current?.setCameraEnabled(!media.cameraEnabled);
  }, [media.cameraEnabled]);

  const startCall = useCallback(
    async (chatId: string, kind: CallKind) => {
      setStarting(true);
      const { data, error } = await startCallRpc(chatId, kind);
      setStarting(false);
      if (error || !data) return { error: error ?? "Не удалось начать звонок" };
      adopt(data);
      // The caller is in the room from the first ring; the peer joins on answer.
      void connectMedia(toActiveCall(data, accountRef.current ?? ""));
      return { error: null };
    },
    [adopt, notify]
  );

  const answer = useCallback(async () => {
    if (!call) return;
    const { data, error } = await answerCallRpc(call.id);
    if (error || !data) {
      notify(error ?? "Не удалось ответить");
      return;
    }
    adopt(data);
    void connectMedia(toActiveCall(data, accountRef.current ?? ""));
  }, [adopt, call, notify, connectMedia]);

  const hangUp = useCallback(
    async (outcome: "ended" | "declined" = "ended") => {
      if (!call) return;
      const { error } = await endCallRpc(call.id, outcome);
      if (error) {
        notify(error);
        return;
      }
      setCall(null);
      await closeMedia();
      // The server may have picked a different final status (missed, declined);
      // reload so the next call is not blocked by a stale live row.
      void reload(call.chatId);
    },
    [call, notify, reload, closeMedia]
  );

  // Leaving the page during a call must release the microphone, otherwise the
  // browser tab keeps the recording indicator on.
  useEffect(() => () => void closeMedia(), [closeMedia]);

  return {
    call,
    starting,
    startCall,
    answer,
    hangUp,
    media,
    attachRemoteVideo,
    toggleMute,
    toggleCamera,
  };
}

/**
 * Appends a chat-line notice, e.g. "Пропущенный звонок".
 *
 * Calls leave a trace in the conversation, otherwise a missed call is invisible
 * the next morning.
 */
export function callNoticeMessage(selfHidden: boolean, text: string, clock: string): Message {
  return {
    id: -Date.now(),
    author: selfHidden ? "Вы" : "Система",
    text,
    time: clock,
    mine: selfHidden,
  };
}

