/** UUIDs remain idempotent when Web Locks are unavailable or blocked by the browser. */
export async function withOutboxLock(name: string, run: () => Promise<void>): Promise<void> {
  if (!navigator.locks) {
    await run();
    return;
  }
  let entered = false;
  try {
    await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
      if (lock) {
        entered = true;
        await run();
      }
    });
  } catch (error) {
    if (entered) throw error;
    await run();
  }
}
