/**
 * Error reporting.
 *
 * The backend is GlitchTip (Sentry-compatible), configured through
 * VITE_SENTRY_DSN. The key is public by design: it can only submit events.
 *
 * This used to swallow every failure silently, which is how the app shipped with
 * error reporting switched off and nobody noticed. Failures now reach the
 * console, so a missing or broken DSN is visible instead of only showing up as
 * an empty dashboard forever.
 */

/** True when a DSN is configured, so callers can tell "off" from "broken". */
export const isMonitoringConfigured = Boolean(import.meta.env.VITE_SENTRY_DSN);

/**
 * Messages that are never actionable.
 *
 * ResizeObserver loops come from the browser and happen in every chat app;
 * chunk-load failures after a redeploy are handled by the service worker update
 * flow. Sending them only buries the real errors.
 */
const IGNORED_MESSAGES: RegExp[] = [
  /ResizeObserver loop/i,
  /ChunkLoadError/i,
  /Loading chunk \d+ failed/i,
  /^Script error\.?$/,
];

export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    console.warn("[monitoring] VITE_SENTRY_DSN is not set; error reporting is disabled");
    return;
  }

  void import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        // No performance tracing: it costs quota and answers no question this
        // project currently has.
        tracesSampleRate: 0,
        // One error inside a render loop produces thousands of identical events
        // and exhausts a free tier in minutes.
        beforeSend(event, hint) {
          const original = hint?.originalException;
          const message = original instanceof Error ? original.message : "";
          const combined = `${message} ${event.message ?? ""}`;
          if (IGNORED_MESSAGES.some((pattern) => pattern.test(combined))) return null;
          return event;
        },
      });
      // A release tag turns "it broke" into "it broke in this build".
      Sentry.setTag("release", String(import.meta.env.VITE_APP_VERSION ?? "dev"));
    })
    .catch((error) => {
      console.error("[monitoring] failed to load the error reporter", error);
    });
}
