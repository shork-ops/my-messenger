import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLastSeen, fetchProfileDetails } from "./profileDetails";

type Reply = { data: unknown; error: { message: string } | null };

/** A client whose rpc and table read answer with what the test says, and record the calls. */
function fakeClient(rpcReply: Reply, tableReply: Reply = { data: [], error: null }) {
  const rpc = vi.fn(async () => rpcReply);
  const inFn = vi.fn(async () => tableReply);
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, from, select, inFn };
}

describe("fetchProfileDetails", () => {
  it("asks nobody when there is nobody to ask", async () => {
    const { client, rpc, from } = fakeClient({ data: [], error: null });
    expect((await fetchProfileDetails(client, [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("reads through the function that applies the owner's rule", async () => {
    const { client, rpc, from } = fakeClient({
      data: [
        { id: "a", avatar_path: "a/photo.webp", about: "Люблю горы" },
        { id: "b", avatar_path: null, about: null },
      ],
      error: null,
    });
    const found = await fetchProfileDetails(client, ["a", "b"]);
    expect(rpc).toHaveBeenCalledWith("profile_details", { user_ids: ["a", "b"] });
    expect(from).not.toHaveBeenCalled();
    expect(found.get("a")).toEqual({ avatar_path: "a/photo.webp", about: "Люблю горы" });
    // Hidden reads exactly like "not set": nothing tells the reader there is something hidden.
    expect(found.get("b")).toEqual({ avatar_path: null, about: null });
  });

  it("falls back to the columns while the migration has not been run", async () => {
    const { client, select, inFn } = fakeClient(
      { data: null, error: { message: "Could not find the function public.profile_details" } },
      { data: [{ id: "a", avatar_path: "a/photo.webp" }], error: null }
    );
    const found = await fetchProfileDetails(client, ["a"]);
    expect(select).toHaveBeenCalledWith("id, avatar_path, about");
    expect(inFn).toHaveBeenCalledWith("id", ["a"]);
    expect(found.get("a")).toEqual({ avatar_path: "a/photo.webp", about: null });
  });

  it("comes back empty, not broken, when both ways fail", async () => {
    const { client } = fakeClient(
      { data: null, error: { message: "network" } },
      { data: null, error: { message: "permission denied for column about" } }
    );
    expect((await fetchProfileDetails(client, ["a"])).size).toBe(0);
  });
});

describe("fetchLastSeen", () => {
  it("reads through the function that applies the owner's rule, hidden as unknown", async () => {
    const { client, rpc, from } = fakeClient({
      data: [
        { id: "a", last_seen_at: "2026-11-03T10:00:00.000Z" },
        { id: "b", last_seen_at: null },
      ],
      error: null,
    });
    const found = await fetchLastSeen(client, ["a", "b"]);
    expect(rpc).toHaveBeenCalledWith("last_seen_of", { user_ids: ["a", "b"] });
    expect(from).not.toHaveBeenCalled();
    expect(found.get("a")).toBe(Date.parse("2026-11-03T10:00:00.000Z"));
    // Hidden and never seen read alike - the header then says «был(а) недавно».
    expect(found.get("b")).toBe(0);
  });

  it("falls back to the column while the migration has not been run", async () => {
    const { client, select, inFn } = fakeClient(
      { data: null, error: { message: "Could not find the function public.last_seen_of" } },
      { data: [{ id: "a", last_seen_at: "2026-11-03T09:00:00.000Z" }], error: null }
    );
    const found = await fetchLastSeen(client, ["a"]);
    expect(select).toHaveBeenCalledWith("id, last_seen_at");
    expect(inFn).toHaveBeenCalledWith("id", ["a"]);
    expect(found.get("a")).toBe(Date.parse("2026-11-03T09:00:00.000Z"));
  });

  it("comes back empty, not broken, when both ways fail, and asks nobody for nobody", async () => {
    const failing = fakeClient(
      { data: null, error: { message: "network" } },
      { data: null, error: { message: "permission denied for column last_seen_at" } }
    );
    expect((await fetchLastSeen(failing.client, ["a"])).size).toBe(0);
    const idle = fakeClient({ data: [], error: null });
    expect((await fetchLastSeen(idle.client, [])).size).toBe(0);
    expect(idle.rpc).not.toHaveBeenCalled();
  });
});
