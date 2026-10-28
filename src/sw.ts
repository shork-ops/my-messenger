/// <reference lib="webworker" />
// Custom service worker: Workbox precaching plus Web Push handling.
// Browsers wake this worker for a `push` event even when the app is closed.
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
self.skipWaiting();

/** SPA navigation fallback: GitHub Pages would answer deep links with 404. */
try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));
} catch {
  // Ignore: the precache manifest always contains index.html in a production build.
}

type PushPayload = { title?: string; body?: string; chatId?: string; messageId?: string };

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data?.text() ?? "Новое сообщение" };
  }
  const chatId = payload.chatId;
  event.waitUntil(
    self.registration.showNotification(payload.title || "Nexus", {
      body: payload.body || "Новое сообщение",
      icon: `${self.registration.scope}icons/icon-192.png`,
      badge: `${self.registration.scope}icons/favicon-32.png`,
      tag: chatId,
      data: { chatId, messageId: payload.messageId },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data as { chatId?: string } | undefined)?.chatId;
  const url = `${self.registration.scope}${target ? `?chat=${encodeURIComponent(target)}` : ""}`;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "open-chat", chatId: target });
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});
