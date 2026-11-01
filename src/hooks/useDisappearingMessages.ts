import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import type { DisappearingSeconds } from "../lib/disappearing";
import type { Chat } from "../types";

type Options = {
  accountId: string | null;
  chats: Chat[];
  setChats: Dispatch<SetStateAction<Chat[]>>;
  /** The open chat, whose timer changes are followed live. */
  activeRemoteId?: string;
  notify: (message: string) => void;
};

type Live = typeof import("../lib/disappearingLive");

/** Timers longer than this are re-armed instead of trusted to one setTimeout. */
const MAX_WAIT_MS = 60 * 60_000;

export function useDisappearingMessages({ accountId, chats, setChats, activeRemoteId, notify }: Options) {
  // Which chat the timer chooser is open for; null when it is closed.
  const [timerChatId, setTimerChatId] = useState<number | null>(null);
  // The rules, loaded right after the first screen (see disappearingLive.ts).
  const [live, setLive] = useState<Live | null>(null);
  // Bumped when a capped wait ends, so the next deadline is armed again.
  const [wake, setWake] = useState(0);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  useEffect(() => {
    let alive = true;
    import("../lib/disappearingLive").then(
      (module) => alive && setLive(module),
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, []);

  // New messages get their deadline and a message leaves the screen at its deadline, not at
  // the next reload. Each change of the list is swept once; the timer wakes for the next one.
  useEffect(() => {
    if (!live) return;
    const { chats: swept, next } = live.sweepDeadlines(chats, Date.now());
    if (swept !== chats) {
      setChats((current) => live.sweepDeadlines(current, Date.now()).chats);
      return;
    }
    if (next === null) return;
    const timer = window.setTimeout(() => setWake((count) => count + 1), Math.min(next - Date.now(), MAX_WAIT_MS));
    return () => window.clearTimeout(timer);
  }, [live, chats, setChats, wake]);

  // A timer switched by the other person shows up here at once.
  useEffect(() => {
    if (!live || !supabase || !accountId || !activeRemoteId) return;
    return live.watchChatTimer(supabase, activeRemoteId, setChats);
  }, [live, accountId, activeRemoteId, setChats]);

  async function applyTimer(seconds: DisappearingSeconds | null) {
    const chat = chatsRef.current.find((item) => item.id === timerChatId);
    setTimerChatId(null);
    if (!chat || (chat.messageTtlSeconds ?? null) === seconds) return;
    // Normally loaded long ago; the chooser could only be opened this fast on a slow network.
    const rules = live ?? (await import("../lib/disappearingLive"));
    await rules.changeChatTimer(supabase, chat, seconds, setChats, notify);
  }

  return {
    timerChatId,
    openTimer: (chatId: number) => setTimerChatId(chatId),
    closeTimer: () => setTimerChatId(null),
    applyTimer,
  };
}
