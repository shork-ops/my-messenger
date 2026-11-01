import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deadlines arrive with each message once migration 20261052 is on the server. Before it,
 * asking for `expires_at` fails, and a failed page shows as an empty chat - so the loader
 * must fall back to the old columns instead of losing the history.
 */
const server = vi.hoisted(() => ({ hasExpiry: true, selects: [] as string[] }));

vi.mock("./supabase", () => {
  const row = { id: "m1", chat_id: "c1", sender_id: "u2", body: "привет", created_at: "2026-11-01T10:00:00Z", expires_at: "2026-11-02T10:00:00Z" };
  const query = (table: string, columns: string) => {
    server.selects.push(`${table}: ${columns}`);
    const result =
      table === "message_hides"
        ? { data: [], error: null }
        : !server.hasExpiry && columns.includes("expires_at")
          ? { data: null, error: { code: "42703", message: "column messages.expires_at does not exist" } }
          : { data: [server.hasExpiry ? row : { ...row, expires_at: undefined }], error: null };
    const chain: Record<string, unknown> = {};
    for (const step of ["eq", "or", "order", "limit", "in"]) chain[step] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
    return chain;
  };
  return { supabase: { from: (table: string) => ({ select: (columns: string) => query(table, columns) }) } };
});

// A fresh module per test: what the last server said about the column is module state.
let sync: typeof import("./messageSync");
beforeEach(async () => {
  server.selects = [];
  vi.resetModules();
  sync = await import("./messageSync");
});

describe("message deadlines", () => {
  it("asks for the deadline and puts it on the message", async () => {
    server.hasExpiry = true;
    const rows = await sync.fetchLatestMessages("c1", 50);
    expect(server.selects[0]).toMatch(/expires_at/);
    const message = await sync.mapMessageRow(rows![0], { accountId: "u1", selfName: "Я", authorName: "Аня" });
    expect(message?.disappearsAt).toBe(Date.parse("2026-11-02T10:00:00Z"));
  });

  it("still loads history from a server without the migration, and stops asking", async () => {
    server.hasExpiry = false;
    const rows = await sync.fetchLatestMessages("c1", 50);
    expect(rows).toHaveLength(1);
    const older = await sync.fetchOlderMessages("c1", { createdAt: "2026-11-01T10:00:00Z", id: "m1" }, 50);
    expect(older).toHaveLength(1);
    const messageSelects = server.selects.filter((entry) => entry.startsWith("messages:"));
    // One refused attempt, then plain columns for this page and the next one.
    expect(messageSelects.map((entry) => entry.includes("expires_at"))).toEqual([true, false, false]);
    const message = await sync.mapMessageRow(rows![0], { accountId: "u1", selfName: "Я", authorName: "Аня" });
    expect(message?.disappearsAt).toBeUndefined();
  });

  it("recognises the missing-column answer and nothing else", () => {
    expect(sync.isMissingExpiryColumn({ code: "42703", message: "column messages.expires_at does not exist" })).toBe(true);
    expect(sync.isMissingExpiryColumn({ code: "PGRST204", message: "" })).toBe(true);
    expect(sync.isMissingExpiryColumn({ code: "42501", message: "permission denied for table messages" })).toBe(false);
    expect(sync.isMissingExpiryColumn(null)).toBe(false);
  });
});
