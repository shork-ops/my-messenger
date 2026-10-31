import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MEDIA_POLICY_STORAGE_KEY,
  type MediaPolicy,
  type NetworkKind,
  parseMediaPolicy,
} from "../lib/mediaPolicy";
import { useOwnerStorage } from "../lib/useOwnerStorage";
import { scopedKey } from "../lib/accountScope";

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

/**
 * The auto-download choice, remembered per device and per account, and the network it applies to.
 *
 * The choice describes what this device does with *this account's* media. Auto-downloading on
 * mobile data is a decision someone made for their own account, so a shared browser must not
 * carry it into the next person's session.
 */
export function useMediaPolicy(accountId: string | null) {
  const { value: policy, setValue: setPolicyState, store } = useOwnerStorage<MediaPolicy>({
    accountId,
    key: MEDIA_POLICY_STORAGE_KEY,
    read: parseMediaPolicy,
    write: (value) => value,
  });
  const [network, setNetwork] = useState<NetworkKind>(readNetwork);

  const setPolicy = useCallback(
    (next: MediaPolicy) => {
      setPolicyState(next);
    },
    [setPolicyState]
  );

  // A change made in another tab of the same account follows along; another account's does not.
  useEffect(() => {
    const fullKey = scopedKey(store.owner, MEDIA_POLICY_STORAGE_KEY);
    const onStorage = (event: StorageEvent) => {
      if (event.key === fullKey) setPolicyState(parseMediaPolicy(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store, setPolicyState]);

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
