/**
 * Retrying a request that failed for a reason worth retrying.
 *
 * A dropped connection is the ordinary case on a phone: the message fails while the
 * train goes into a tunnel and would succeed a second later. Without a retry the user
 * sees one error and has to type the message again, which is the worst possible way to
 * lose what they wrote.
 *
 * Not every failure deserves a retry. A rejected permission or a validation error will
 * be rejected again, and retrying it just delays the message the user needs to see. Only
 * transient failures are retried, and the caller says which those are, because only it
 * knows what "transient" means for its request.
 */

export type RetryOptions = {
  /** How many times to try in total, including the first. */
  attempts?: number;
  /** Delay before the first retry; each further retry doubles it. */
  baseDelayMs?: number;
  /** Upper bound on a single delay, so a long outage does not wait minutes. */
  maxDelayMs?: number;
  /** Whether this failure is worth another attempt. */
  shouldRetry: (error: unknown) => boolean;
  /** Waiting, injected so tests do not actually sleep. */
  wait?: (ms: number) => Promise<void>;
};

export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 400;
export const DEFAULT_MAX_DELAY_MS = 4000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full jitter would spread retries better; this keeps the schedule predictable in tests. */
function delayFor(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}

/**
 * Runs `operation` until it succeeds, fails with something not worth retrying, or runs
 * out of attempts. The last error is rethrown, so the caller still sees why it failed.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const wait = options.wait ?? sleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts - 1;
      if (isLast || !options.shouldRetry(error)) throw error;
      await wait(delayFor(attempt, baseDelayMs, maxDelayMs));
    }
  }
  throw lastError;
}

/**
 * Whether a Supabase error looks like a connection problem rather than a refusal.
 *
 * Supabase reports a network failure as a message mentioning fetch; a policy refusal
 * arrives as a Postgres error code. Retrying the second kind would be wrong, so only
 * the shapes that mean "try again" are accepted.
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { message?: unknown; code?: unknown; status?: unknown };

  if (typeof record.message === "string") {
    const message = record.message.toLowerCase();
    if (message.includes("failed to fetch")) return true;
    if (message.includes("networkerror")) return true;
    if (message.includes("network error")) return true;
    if (message.includes("timeout")) return true;
    if (message.includes("econnreset")) return true;
    if (message.includes("load failed")) return true;
  }

  // Postgres surfaces a lost connection as 08xxx, and a statement cancelled by a
  // timeout as 57014. Both are worth another try.
  if (typeof record.code === "string") {
    const code = record.code;
    if (code.startsWith("08")) return true;
    if (code === "57014") return true;
  }

  // 5xx from the gateway is the server being briefly unavailable.
  if (typeof record.status === "number") {
    return record.status >= 500 && record.status < 600;
  }

  return false;
}
