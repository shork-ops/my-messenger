export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({ dsn, environment: import.meta.env.MODE, tracesSampleRate: 0 });
    })
    .catch(() => undefined);
}
