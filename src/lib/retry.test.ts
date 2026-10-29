import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ATTEMPTS, DEFAULT_BASE_DELAY_MS, isTransientError, withRetry } from "./retry";

/** Records the waits instead of sleeping, so the schedule can be asserted. */
function recorder() {
  const waits: number[] = [];
  return { waits, wait: async (ms: number) => void waits.push(ms) };
}

const transient = () => true;
const never = () => false;

describe("withRetry", () => {
  it("returns the first success without waiting", async () => {
    const { waits, wait } = recorder();
    const result = await withRetry(async () => "ok", { shouldRetry: transient, wait });
    expect(result).toBe("ok");
    expect(waits).toEqual([]);
  });

  it("retries a failure and returns the later success", async () => {
    const { waits, wait } = recorder();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("failed to fetch");
        return "ok";
      },
      { shouldRetry: transient, wait }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("doubles the delay and caps it", async () => {
    const { waits, wait } = recorder();
    await withRetry(
      async () => {
        throw new Error("boom");
      },
      { attempts: 4, baseDelayMs: 100, maxDelayMs: 300, shouldRetry: transient, wait }
    ).catch(() => {});
    expect(waits).toEqual([100, 200, 300]);
  });

  it("gives up after the last attempt and rethrows the error", async () => {
    const { wait } = recorder();
    const operation = vi.fn(async () => {
      throw new Error("still down");
    });
    await expect(withRetry(operation, { attempts: 3, shouldRetry: transient, wait })).rejects.toThrow("still down");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry a failure that will not change", async () => {
    const { waits, wait } = recorder();
    const operation = vi.fn(async () => {
      throw new Error("permission denied");
    });
    await expect(withRetry(operation, { shouldRetry: never, wait })).rejects.toThrow("permission denied");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("tries once when attempts is one", async () => {
    const { wait } = recorder();
    const operation = vi.fn(async () => {
      throw new Error("once");
    });
    await expect(withRetry(operation, { attempts: 1, shouldRetry: transient, wait })).rejects.toThrow("once");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops retrying as soon as the failure stops being transient", async () => {
    const { wait } = recorder();
    let calls = 0;
    const operation = async () => {
      calls += 1;
      throw new Error(calls === 1 ? "failed to fetch" : "invalid input");
    };
    await expect(withRetry(operation, { attempts: 5, shouldRetry: isTransientError, wait })).rejects.toThrow("invalid input");
    expect(calls).toBe(2);
  });

  it("has sane defaults", () => {
    expect(DEFAULT_ATTEMPTS).toBeGreaterThan(1);
    expect(DEFAULT_BASE_DELAY_MS).toBeGreaterThan(0);
  });
});

describe("isTransientError", () => {
  it("accepts a failed fetch", () => {
    expect(isTransientError(new Error("TypeError: Failed to fetch"))).toBe(true);
  });

  it("accepts a network error", () => {
    expect(isTransientError({ message: "NetworkError when attempting to fetch resource." })).toBe(true);
  });

  it("accepts a lost database connection", () => {
    expect(isTransientError({ message: "connection lost", code: "08006" })).toBe(true);
  });

  it("accepts a statement cancelled by a timeout", () => {
    expect(isTransientError({ code: "57014" })).toBe(true);
  });

  it("accepts a gateway failure", () => {
    expect(isTransientError({ message: "bad gateway", status: 503 })).toBe(true);
  });

  it("refuses a policy refusal", () => {
    expect(isTransientError({ message: "new row violates row-level security policy", code: "42501" })).toBe(false);
  });

  it("refuses a validation error", () => {
    expect(isTransientError({ message: "duplicate key value violates unique constraint", code: "23505" })).toBe(false);
  });

  it("refuses a client error", () => {
    expect(isTransientError({ message: "bad request", status: 400 })).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError("a string")).toBe(false);
  });
});
