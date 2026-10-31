// Checks the revoke-session function's decisions without Deno or a network.
//
// The function is Deno code, so neither tsconfig nor vitest compiles it - which is exactly how the
// previous version could call `admin.auth.admin.listUserSessions`, a method that does not exist, and
// still look correct in review. This script does two things:
//
//   1. Exercises the token-reading algorithm on real inputs and pins that the module still contains
//      that algorithm, so a rewrite cannot quietly drop the check.
//   2. Pins the security properties a future edit could silently reverse, as text assertions.
//
// Text assertions are weaker than execution and the output says so. What they do catch is the
// realistic failure: someone "fixing" the function by trusting a body-supplied user id, or by
// promising the instant cut-off it cannot deliver.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const source = readFileSync("supabase/functions/revoke-session/index.ts", "utf8");

// --- 1. the reader, exercised on real inputs ------------------------------------------------------
const claims = (payload) => ["h", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

/** The algorithm the function documents for reading `session_id`, run here on the same inputs. */
function readSessionId(accessToken) {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.session_id === "string" && decoded.session_id.length > 0 ? decoded.session_id : null;
  } catch {
    return null;
  }
}

// The reader only counts if the module really contains this shape.
assert.ok(source.includes("function sessionIdFromToken"), "the reader was renamed or removed");
assert.ok(source.includes("decoded.session_id"), "the reader no longer reads session_id");
assert.ok(source.includes("parts.length !== 3"), "the reader no longer validates the token shape");

assert.equal(
  readSessionId(claims({ sub: "u", session_id: "11111111-1111-4111-8111-111111111111" })),
  "11111111-1111-4111-8111-111111111111",
  "a valid claim must be read"
);
assert.equal(readSessionId(claims({ sub: "u" })), null, "no claim must mean no session id");
assert.equal(readSessionId(claims({ session_id: "" })), null, "an empty claim must not be used");
assert.equal(readSessionId("not-a-jwt"), null, "a malformed token must not throw");
assert.equal(readSessionId(""), null);

// --- 2. the decisions, pinned as text -------------------------------------------------------------
const mustContain = (needle, why) => assert.ok(source.includes(needle), `missing: ${needle} - ${why}`);

mustContain("callerClient.auth.getUser()", "identity must come from the verified token");
mustContain("admin.auth.admin.signOut(", "revocation must go through the auth server");
mustContain("accessToken, scope)", "the scope must be passed through, not defaulted silently");
mustContain(`["local", "others", "global"]`, "only the three real scopes may be accepted");
mustContain("if (userError || !userData.user)", "an unauthenticated caller must be refused");
mustContain(`!authorization.toLowerCase().startsWith("bearer ")`, "a missing token must be refused early");
mustContain("misconfigured", "a missing service key must be reported, not treated as success");

// The function must never take a user id from the request body. A body-supplied identity is the
// classic way "sign out my devices" becomes "sign out anybody's devices".
assert.ok(
  !/body\.(userId|user_id|sub)\b/.test(source),
  "the function must not read a user id from the request body"
);
// And it must not promise an instant cut-off, because it cannot deliver one. Scoped to the shape a
// real promise would take rather than to every occurrence of the word: the comment saying "instead of
// 'instantly'" is the opposite of a promise and must not trip this.
assert.ok(
  !/instantRevocation|cutOffNow|revokedImmediately/i.test(source),
  "the function must not promise an instant cut-off"
);
// What it does promise must include the residual token lifetime, so the screen can say "up to an hour".
mustContain("accessTokenLifetimeSeconds", "the guarantee must state the residual token lifetime");

console.log(
  "PASS: revoke-session reads identity from the verified token, accepts only the three real scopes, " +
    "revokes through the auth server, takes no user id from the body, reports a missing key as " +
    "misconfiguration rather than success, and states the residual access-token lifetime. " +
    "NOTE: the decision checks are text assertions on Deno code this repository cannot execute; " +
    "the end-to-end behaviour needs a deployed function and a signed-in session."
);
