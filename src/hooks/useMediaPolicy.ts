import { useCallback, useEffect, useState } from "react";
import {
  MEDIA_POLICY_STORAGE_KEY,
  type MediaPolicy,
  type NetworkKind,
  parseMediaPolicy,
} from "../lib/mediaPolicy";

/** The Network Information API, where the browser has it. */
type NetworkInformation = { type?: string; effectiveType?: string };

function readNetwork(): NetworkKind {
  if (typeof navigator === "undefined") return "unknown";
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!connection) return "unknown";
  if (connection.type === "cellular" || connection.effectiveType === "2g" || connection.effectiveType === "3g") {
    return "cellular";
  }
  if (connection.type === "wifi" || connection.type === "ethernet") return "wifi";
  // "4g" with no type is a fast connection whose medium is unknown; treating it as
  // Wi-Fi matches what the browser implies by calling it fast.
  return "unknown";
}

/** The auto-download choice, remembered per device, and the network it applies to. */
export function useMediaPolicy() {
  const [policy, setPolicyState] = useState<MediaPolicy>(() => {
    if (typeof window === "undefined") return parseMediaPolicy(null);
    try {
      return parseMediaPolicy(window.localStorage.getItem(MEDIA_POLICY_STORAGE_KEY));
    } catch {
      return parseMediaPolicy(null);
    }
  });
  const [network, setNetwork] = useState<NetworkKind>(readNetwork);

  const setPolicy = useCallback((next: MediaPolicy) => {
    setPolicyState(next);
    try {
      window.localStorage.setItem(MEDIA_POLICY_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice holds for this session.
    }
  }, []);

  // Moving between Wi-Fi and a phone network changes what auto-download means, so
  // the answer is refreshed rather than read once at startup.
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (!connection) return;
    const refresh = () => setNetwork(readNetwork());
    connection.addEventListener("change", refresh);
    return () => connection.removeEventListener("change", refresh);
  }, []);

  return { policy, setPolicy, network };
}
