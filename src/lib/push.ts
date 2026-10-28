import { supabase } from "../lib/supabase";

/** The service worker must be the one registered by vite-plugin-pwa (`/my-messenger/sw.js`). */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)) ?? null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let index = 0; index < rawData.length; index += 1) bytes[index] = rawData.charCodeAt(index);
  return bytes;
}

export function pushConfigured(): boolean {
  return Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY);
}

export type PushSubscribeResult =
  | "subscribed"
  | "unsupported"
  | "denied"
  | "not-configured"
  | "push-service"
  | "error";

/** Maps a failed pushManager.subscribe() call to a status the UI can explain. */
function classifySubscribeError(error: unknown): PushSubscribeResult {
  const name = (error as { name?: string } | null)?.name;
  // AbortError means Chrome could not reach its push service (FCM); the
  // subscription never reaches the network, so it is not a backend problem.
  if (name === "AbortError" || name === "NotAllowedError") return "push-service";
  console.warn("[push] subscribe failed", error);
  return "error";
}

/**
 * Registers a PushSubscription for the current user. Requires:
 * - Notification permission,
 * - a service worker in scope,
 * - VITE_VAPID_PUBLIC_KEY in the build.
 * Returns a human-readable status so the UI can explain what stopped the flow.
 */
export async function subscribeToPush(accountId: string): Promise<PushSubscribeResult> {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!publicKey) return "not-configured";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "granted") return "denied";

  const registration = await getServiceWorkerRegistration();
  if (!registration) return "error";

  let subscription: PushSubscription;
  try {
    const existing = await registration.pushManager.getSubscription();
    subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
  } catch (error) {
    return classifySubscribeError(error);
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "error";
  if (!supabase) return "not-configured";
  try {
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: accountId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent.slice(0, 180),
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "user_id,endpoint" }
    );
    if (error) {
      console.warn("[push] storing the subscription failed", error);
      return "error";
    }
    return "subscribed";
  } catch (error) {
    console.warn("[push] storing the subscription failed", error);
    return "error";
  }
}

/** Removes the browser subscription and its row so the user stops receiving pushes. */
export async function unsubscribeFromPush(accountId: string): Promise<boolean> {
  const registration = await getServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    if (supabase) await supabase.from("push_subscriptions").delete().eq("user_id", accountId).eq("endpoint", endpoint);
  } else if (supabase) {
    await supabase.from("push_subscriptions").delete().eq("user_id", accountId);
  }
  return true;
}

/** True when this browser already has an active push subscription. */
export async function hasPushSubscription(): Promise<boolean> {
  const registration = await getServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return Boolean(subscription);
}
