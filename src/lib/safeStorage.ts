/**
 * Local storage that never throws.
 *
 * Safari in private mode throws on every `localStorage` call, and a full quota throws
 * on write. Read naively, that is not a degraded experience but a white screen: the
 * first `useState` initialiser throws before anything renders. The app keeps working
 * without the things it remembers, which is the right trade — a theme that resets is
 * better than a chat that does not open.
 *
 * The backing store is looked up on every call rather than captured, because the one
 * that exists when this module loads is not always the one in use: tests replace it,
 * and a browser extension can too. A missing window (tests, a server) reads as absent
 * storage rather than a crash.
 */

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // Even reading the property throws in some locked-down configurations.
    return null;
  }
}

export function readItem(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    // A full quota or a locked-down browser: the write is lost, which is acceptable.
  }
}

export function removeItem(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // Nothing to do; the value stays but is unreadable anyway.
  }
}

/** Whether storage works at all, for the one place that tells the user. */
export function storageAvailable(): boolean {
  const backing = store();
  if (!backing) return false;
  try {
    const probe = "__nexus_probe__";
    backing.setItem(probe, "1");
    backing.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
