/**
 * Starting a call from a conversation.
 *
 * `useCalls` owns the call itself: signalling, tracks, the media elements. What it cannot know is
 * where the call was started from - which conversation, how many people are in it, and what the
 * free plan allows. That is what this hook adds, and it is the part that produces the messages a
 * person reads before a call rather than during one.
 *
 * The distinction matters: a person who learns "участников больше, чем можно" by hearing
 * "соединение потеряно" mid-conversation concludes the messenger is broken.
 */

import { useState } from "react";
import type { Chat } from "../types";
import { useCalls } from "./useCalls";
import { describeCallError } from "../lib/calls";
import { FREE_PLAN_MAX_PARTICIPANTS, minutesWarning, participantLimitNotice } from "../lib/callPlan";

export function useCallController(input: {
  accountId: string | null;
  activeChat: Chat;
  notify: (text: string) => void;
}) {
  const calls = useCalls({
    accountId: input.accountId,
    enabled: Boolean(input.accountId),
    notify: input.notify,
  });
  const [callError, setCallError] = useState<string | null>(null);

  const startCallNow = async (kind: "audio" | "video") => {
    setCallError(null);
    // Calls are cloud-only: a demo chat has no remoteId, so there is nothing to signal.
    const remoteId = input.activeChat.remoteId;
    if (!remoteId) {
      input.notify("Звонки доступны в облачных чатах");
      return;
    }
    // The free plan is named *before* the call, not discovered during it. A group call is where
    // the cap can actually be reached, so that is where the count is checked.
    const callMembers = input.activeChat.members?.length ?? 0;
    if (callMembers >= FREE_PLAN_MAX_PARTICIPANTS) {
      const notice = participantLimitNotice(callMembers);
      if (notice) {
        input.notify(notice);
        return;
      }
    }
    const planWarning = minutesWarning(null);
    if (planWarning) input.notify(planWarning);
    const result = await calls.startCall(remoteId, kind);
    if (result.error) setCallError(describeCallError(result.error));
  };

  return { ...calls, callError, setCallError, startCallNow };
}
