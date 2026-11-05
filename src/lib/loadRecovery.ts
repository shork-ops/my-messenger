export type LoadStatus = "loading" | "ready" | "error";

/** One request at a time; failed reads retry with backoff and on reconnect/focus. */
export function recoverLoad(load: () => Promise<void>, status: (value: LoadStatus) => void) {
  let alive = true,
    busy = false,
    failed = false,
    delay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (!alive || busy) return;
    clearTimeout(timer);
    busy = true;
    status("loading");
    try {
      await load();
      if (alive) {
        failed = false;
        delay = 1000;
        status("ready");
      }
    } catch {
      if (alive) {
        failed = true;
        status("error");
        timer = setTimeout(() => {
          if (document.visibilityState === "visible") void run();
        }, delay);
        delay = Math.min(delay * 2, 30_000);
      }
    } finally {
      busy = false;
    }
  };
  const reconnect = () => {
    if (failed && document.visibilityState === "visible") void run();
  };
  window.addEventListener("online", reconnect);
  document.addEventListener("visibilitychange", reconnect);
  void run();
  return {
    retry: () => {
      void run();
    },
    dispose: () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    },
  };
}
