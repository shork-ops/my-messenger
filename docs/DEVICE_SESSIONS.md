# Device sessions

What this replaces, how revocation actually works, and what is still not true.

This document has been rewritten. The previous version claimed that ending a session "prevents the
refresh", while nothing enforced that: the flag it relied on was in our own table, and Supabase Auth
never reads it. A review caught it. The section "What was wrong the second time" is the record of
that, because a doc that quietly drops a false claim teaches nobody anything.

## What was wrong the first time

The settings screen showed a list of "devices" that the browser wrote itself, in local storage. It
could only contain things that had opened the app *in this browser profile*:

- A phone never appeared, because a phone writes its own list on the phone.
- A device stayed in the list after it had signed out, because nothing removed it.
- Two laptops using the profile looked like two rows even if only one was signed in, and one laptop
  used by two people looked like one row.
- It was not scoped per account, so it was also one of the cross-account leaks fixed in
  `ACCOUNT_ISOLATION.md`.

The button beside it deleted rows from that local list. It looked like revocation and revoked
nothing.

## What was wrong the second time

Replacing the fake list with a server table fixed the display and left the promise untouched. Five
things were wrong, and the tests did not catch them because they checked the row rather than the
meaning:

1. **`revoked_at` did not stop a refresh.** Supabase Auth (GoTrue) decides whether to honour a refresh
   token by consulting its own `sessions` and `refresh_tokens` tables. `public.device_sessions` is not
   part of that decision. Writing `revoked_at` was a diary entry.
2. **Registration cleared the flag.** `device_register_session` did `revoked_at = null` on conflict,
   and registration runs on every app start. A revoked device came back to life the next time it was
   opened.
3. **`device_session_active` proved nothing.** It answered a boolean about our row and could not
   influence anything.
4. **The auth session id came from the client**, so a client could claim any id it liked.
5. **The client function was a stub that always returned `null`**, so the session binding did not
   exist even on paper. It compiled, it was called, and it did nothing.

## How revocation works now

**The only thing that ends a session is revoking it in Supabase Auth.** That requires the service role
key, which must never reach a browser, so it happens in
`supabase/functions/revoke-session/index.ts` and nowhere else.

The function calls `admin.auth.admin.signOut(accessToken, scope)`:

| Action in the UI | Scope | What the auth server does |
| --- | --- | --- |
| «Выйти здесь» | `local` | Revokes the caller's own session |
| «Выйти на других» | `others` | Revokes every other session of the account |

GoTrue marks the refresh tokens revoked (and/or sets `sessions.not_after`), and the refresh grant
refuses them. That is a real revocation, and it is the mechanism Supabase supports.

Authorization, in order: the caller must present a valid JWT and the identity is read from that token
via `getUser()`; the function never accepts a user id in the body; only the caller's own account is
acted on. The service key stays in the function's environment.

### What is deliberately not offered

**There is no per-row "end this device" button.** Supabase's admin API in supabase-js 2.118 exposes
`signOut(jwt, scope)` and nothing per session — `listUserSessions` and `deleteUserSession` do not exist
in that version, which was checked in the installed package rather than assumed. A per-device button
would therefore either do nothing or sign out everything while claiming to end one. The list shows what
is signed in; the honest actions are "this device" and "all others".

## What is still not true, and is stated in the UI

**Ending a session does not cut off an access token that device already holds.**

- The refresh token is refused from the moment the auth server revokes the session. The device cannot
  obtain a new access token.
- An access token already issued keeps working until it expires — by default **up to one hour**.
  Supabase validates a JWT by signature and expiry; no request path asks a table whether the session
  is still wanted.
- Therefore a signed-out phone may keep working for up to an hour.

`DEVICE_SESSIONS_LIMITS` in `src/lib/deviceSessions.ts` carries exactly this text and the panel renders
it. A settings screen that says "signed out everywhere" while a phone keeps working for an hour is
lying about the one thing the button was pressed for.

Making the cut-off immediate would need one of: much shorter access-token lifetimes (with the refresh
churn that implies), or a server-side authorisation check on every request (a lookup per call). Neither
is in this branch.

## The table and its functions

`supabase/migrations/20261052_device_sessions.sql` adds `device_sessions`:

`id`, `user_id`, `client_id`, `device_label`, `platform`, `created_at`, `last_seen_at`, `revoked_at`,
`revoked_reason`, `auth_session_id`.

**No refresh token, no access token, no hash of either.** A check asserts no column named `token`,
`access_token`, `refresh_token` or `password` exists on the table.

| Function | What it does | Who can call it |
| --- | --- | --- |
| `device_register_session(client_id, label, platform, auth_session_id)` | Upserts this browser's row. The auth session id comes from `auth.jwt() ->> 'session_id'`; the parameter is ignored. A revoked row is refused unless a *different* auth session id is presented | `authenticated` |
| `device_list_sessions(current_client_id)` | Up to 50 active rows, newest first, `is_current` marked | `authenticated` |
| `device_session_active(auth_session_id)` | Whether one of the caller's own rows is marked ended. A lookup in our table, not a statement about Supabase | `authenticated` |
| `device_sessions_prune()` | Deletes rows revoked >90 days ago or unseen >180 days | nobody (service role only) |

The old `device_revoke_session` and `device_revoke_others` are **dropped**. They looked like
revocation, performed none, and sitting beside a function that does the real thing would invite exactly
the mistake this round exists to fix. A client calling them gets "function does not exist", which the
client reports as "not deployed" — impossible to mistake for success.

### Why one person cannot touch another's sessions

1. `auth.uid()` is the only owner the functions know; no function takes a user id.
2. Every write is scoped by `user_id = me` in the SQL.
3. RLS with a select-only own-rows policy; no insert/update/delete grant at all.
4. The auth session id is read from the verified token, so it cannot be claimed.

## Verification

`npm run test:device-sessions` — 18 checks on PGlite with real roles, `auth.uid()` and `auth.jwt()`
simulated. `npm run test:unit` covers the client.

The checks that matter most here are negative:

- a revoked session that re-registers with the **same** token is refused (`session_revoked`) and its
  `revoked_at` survives;
- a **different** auth session id — a genuinely new sign-in — does take the row over;
- a client-supplied session id is ignored in favour of the token's claim;
- no client-callable function can mark a row revoked, and the table refuses direct updates;
- bob cannot read or reach alice's rows by any route.

A **negative control** (`.tmp/control-resurrect.mjs`) reinstates the old `on conflict ... revoked_at =
null` body and shows it still resurrects a revoked row while the fixed function refuses. That proves
the resurrection check discriminates between the fix and the bug rather than passing vacuously.

## What is prepared versus what is live

- **Prepared, locally verified:** the migration, the Edge Function, the client, the hook, the panel,
  18 database checks, unit tests.
- **Not applied to the cloud project.** `device_sessions` does not exist on `wuifyiqnkpridblufxzs` (see
  `CLOUD_STATE_PROBE.md`). Until it is applied the panel says the list is unavailable — the correct
  thing to say.
- **The Edge Function is not deployed.** Until it is, "Выйти на других" reports "not deployed" and
  revokes nothing. This is the honest state: the button does not pretend.
- **The end-to-end cloud check was NOT performed.** It needs two signed-in clients of one account plus
  one of another, and there is no authorised test account: the only enabled provider is Google OAuth,
  `mailer_autoconfirm=false`, and `SUPABASE_SERVICE_ROLE_KEY` in `.env` is a name with no value. This is
  a blocked check, not a passed one. What *is* proven is the SQL behaviour and the auth mechanism, in
  the GoTrue source and on the stand.

## Order of deployment

1. `20261052_device_sessions.sql` (drops the two decoy functions — check no client still calls them;
   this branch's client does not).
2. Deploy `revoke-session`. It needs `SUPABASE_SERVICE_ROLE_KEY` set in the function environment, which
   the platform provides to deployed functions.
3. Then the UI actions work. Before step 2 they report "not deployed" and change nothing.

Rollback: dropping `device_sessions` and `revoke-session` returns to the previous state. No other table
references them, and no user content is stored in them beyond device labels.

## Pruning

`device_sessions_prune()` is not executable by any client. Rows revoked more than 90 days ago, or
active rows unseen for more than 180 days, are deleted. A session list kept forever becomes a record of
where someone has been. Wiring it into the scheduled maintenance path is a follow-up; leaving it unrun
costs only rows nobody sees.
