/**
 * Account isolation for local caches.
 *
 * The failure this file exists to prevent is not a crash: it is account B opening the app and
 * reading account A's drafts, chats or game in progress, or A's stale response writing into B's
 * storage. None of those announce themselves, so the checks below are written as the abuses: what
 * B must *not* be able to see, adopt, or overwrite.
 */

/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  GUEST_SCOPE,
  SCOPE_PREFIX,
  isEmptyForStorage,
  keyBelongsTo,
  mayAdoptLegacy,
  ownerFor,
  scopedKey,
} from "./accountScope";
import { scopedStore } from "./scopedStorage";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  window.localStorage.clear();
});

describe("whose storage is this", () => {
  it("uses the auth user id, not a name or an email, as the owner", () => {
    // Two accounts may share a display name and a display name is user-editable, so it cannot
    // identify anyone. Only the uuid can.
    expect(ownerFor(ALPHA).scope).toBe(`u:${ALPHA}`);
    expect(ownerFor(BETA).scope).not.toBe(ownerFor(ALPHA).scope);
    expect(ownerFor("Alex").scope).not.toBe(ownerFor(ALPHA).scope);
    expect(ownerFor("alex@example.com").scope).not.toBe(ownerFor(ALPHA).scope);
  });

  it("treats the same uuid in either case as one owner", () => {
    // Postgres renders uuids in either case depending on the source; two namespaces for one
    // person would look exactly like data loss.
    expect(ownerFor(ALPHA.toUpperCase()).scope).toBe(ownerFor(ALPHA).scope);
    expect(ownerFor(`  ${ALPHA}  `).scope).toBe(ownerFor(ALPHA).scope);
  });

  it("gives a guest its own namespace rather than sharing with everyone signed out", () => {
    expect(ownerFor(null)).toEqual({ scope: GUEST_SCOPE, accountId: null });
    expect(ownerFor(undefined)).toEqual({ scope: GUEST_SCOPE, accountId: null });
    expect(ownerFor("")).toEqual({ scope: GUEST_SCOPE, accountId: null });
    // The guest namespace must not be reachable as an account: a uuid cannot equal "guest".
    expect(ownerFor(ALPHA).scope).not.toBe(GUEST_SCOPE);
  });

  it("builds keys that are recognisably one owner's", () => {
    const alpha = ownerFor(ALPHA);
    const key = scopedKey(alpha, "nexus-drafts-v1");
    expect(key.startsWith(SCOPE_PREFIX)).toBe(true);
    expect(keyBelongsTo(key, alpha)).toBe(true);
    expect(keyBelongsTo(key, ownerFor(BETA))).toBe(false);
    expect(keyBelongsTo(key, ownerFor(null))).toBe(false);
    // A legacy key belongs to nobody, so it is never silently read as anyone's.
    expect(keyBelongsTo("nexus-drafts-v1", alpha)).toBe(false);
  });
});

describe("writing and reading as two accounts", () => {
  it("keeps A's data invisible to B in the same browser", () => {
    const alpha = scopedStore(ALPHA);
    const beta = scopedStore(BETA);
    alpha.write("nexus-drafts-v1", JSON.stringify({ 1: "черновик A" }));

    expect(alpha.read("nexus-drafts-v1")).toContain("черновик A");
    expect(beta.read("nexus-drafts-v1")).toBeNull();
  });

  it("keeps the guest separate from every account in both directions", () => {
    const alpha = scopedStore(ALPHA);
    const guest = scopedStore(null);
    alpha.write("nexus-chats-v1", JSON.stringify([{ id: 1, name: "Работа" }]));
    guest.write("nexus-chats-v1", JSON.stringify([{ id: 9, name: "Демо" }]));

    expect(alpha.read("nexus-chats-v1")).toContain("Работа");
    expect(alpha.read("nexus-chats-v1")).not.toContain("Демо");
    expect(guest.read("nexus-chats-v1")).toContain("Демо");
    expect(guest.read("nexus-chats-v1")).not.toContain("Работа");
  });

  it("does not let B overwrite A by writing the same logical key", () => {
    const alpha = scopedStore(ALPHA);
    const beta = scopedStore(BETA);
    alpha.write("nexus-drafts-v1", JSON.stringify({ 1: "A" }));
    beta.write("nexus-drafts-v1", JSON.stringify({ 1: "B" }));
    // Both survive: one account's write is not the other's delete.
    expect(alpha.read("nexus-drafts-v1")).toContain('"A"');
    expect(beta.read("nexus-drafts-v1")).toContain('"B"');
  });

  it("clearing A leaves B and the legacy cache untouched", () => {
    const alpha = scopedStore(ALPHA);
    const beta = scopedStore(BETA);
    alpha.write("nexus-chats-v1", JSON.stringify([{ id: 1, name: "Работа" }]));
    alpha.write("nexus-drafts-v1", JSON.stringify({ 1: "A" }));
    beta.write("nexus-drafts-v1", JSON.stringify({ 1: "B" }));
    window.localStorage.setItem("nexus-legacy-thing", "keep me");

    const removed = alpha.clear();

    expect(removed).toBeGreaterThan(0);
    expect(alpha.read("nexus-drafts-v1")).toBeNull();
    expect(beta.read("nexus-drafts-v1")).toContain("B");
    expect(window.localStorage.getItem("nexus-legacy-thing")).toBe("keep me");
  });

  it("does not store an empty cache, so 'used' stays answerable", () => {
    const alpha = scopedStore(ALPHA);
    alpha.write("nexus-drafts-v1", "{}");
    expect(alpha.read("nexus-drafts-v1")).toBeNull();
    expect(alpha.hasAny()).toBe(false);

    alpha.write("nexus-drafts-v1", JSON.stringify({ 1: "x" }));
    expect(alpha.hasAny()).toBe(true);
  });

  it("lists only its own keys", () => {
    scopedStore(ALPHA).write("a", JSON.stringify({ v: 1 }));
    scopedStore(ALPHA).write("b", JSON.stringify({ v: 1 }));
    scopedStore(BETA).write("c", JSON.stringify({ v: 1 }));
    expect(scopedStore(ALPHA).keys().sort()).toEqual(["a", "b"]);
    expect(scopedStore(BETA).keys()).toEqual(["c"]);
  });
});

describe("migrating an old shared cache", () => {
  it("refuses to hand the old cache to the first account that signs in", () => {
    // The old build wrote one shared key with no owner inside it. Giving it to whoever signs in
    // first is exactly the leak this whole exercise is about, so data with no owner field must
    // never be adopted.
    const shared = [{ id: 1, name: "Работа", messages: [] }];
    const verdict = mayAdoptLegacy(shared, ALPHA);
    expect(verdict.adopt).toBe(false);
  });

  it("adopts only records that name this account and no one else", () => {
    const mine = [{ uuid: "1", senderId: ALPHA, message: { text: "привет" } }];
    expect(mayAdoptLegacy(mine, ALPHA)).toEqual({ adopt: true });

    // The same outbox seen by a different account is not its data, even though it parses.
    expect(mayAdoptLegacy(mine, BETA).adopt).toBe(false);
  });

  it("refuses a mixed cache rather than adopting it wholesale", () => {
    // A shared key from a device where two people had signed in: adopting it would give one
    // person the other's queued messages.
    const mixed = [
      { uuid: "1", senderId: ALPHA, message: { text: "A" } },
      { uuid: "2", senderId: BETA, message: { text: "B" } },
    ];
    const verdict = mayAdoptLegacy(mixed, ALPHA);
    expect(verdict.adopt).toBe(false);
    if (!verdict.adopt) expect(verdict.reason).toMatch(/чуж/);
  });

  it("refuses on behalf of a guest, who cannot prove ownership of anything", () => {
    expect(mayAdoptLegacy([{ senderId: ALPHA }], null).adopt).toBe(false);
  });

  it("refuses an empty or unreadable cache", () => {
    expect(mayAdoptLegacy([], ALPHA).adopt).toBe(false);
    expect(mayAdoptLegacy("just a string", ALPHA).adopt).toBe(false);
    expect(mayAdoptLegacy(42, ALPHA).adopt).toBe(false);
    expect(mayAdoptLegacy(null, ALPHA).adopt).toBe(false);
  });

  it("accepts an object that names this account", () => {
    expect(mayAdoptLegacy({ accountId: ALPHA, wallpaper: "dark" }, ALPHA)).toEqual({ adopt: true });
    expect(mayAdoptLegacy({ accountId: BETA, wallpaper: "dark" }, ALPHA).adopt).toBe(false);
  });
});

describe("what counts as an empty cache", () => {
  it("treats empty containers and nulls as empty", () => {
    expect(isEmptyForStorage(null)).toBe(true);
    expect(isEmptyForStorage(undefined)).toBe(true);
    expect(isEmptyForStorage([])).toBe(true);
    expect(isEmptyForStorage({})).toBe(true);
  });

  it("treats real content as content", () => {
    expect(isEmptyForStorage([0])).toBe(false);
    expect(isEmptyForStorage({ a: null })).toBe(false);
    expect(isEmptyForStorage("")).toBe(false);
    expect(isEmptyForStorage(0)).toBe(false);
  });
});
