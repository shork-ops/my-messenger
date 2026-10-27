# Nexus Messenger — security and architecture audit

**Baseline:** `main` at `ba0813404d770a8a7ddf4a0313d3bd8178b9e8ef`; security branch reviewed separately.  
**Method:** static review of React/TypeScript, Supabase SQL/RLS/storage migrations, package/config and CI. This is not a penetration test. The live Supabase project and its actual grants were not accessible.

## Executive summary

Nexus is a React + TypeScript + Vite web client using Supabase Auth, Postgres, Storage and Realtime. It is a functional prototype, but should not yet be represented as equivalent to a production messenger in security, privacy, reliability or scale.

## Findings

| Severity | Finding | Evidence / impact | Status |
|---|---|---|---|
| **High** | Message rows have broad UPDATE permissions | Base schema grants table-level UPDATE and RLS limits the row to its sender/member, but not which columns can change. A malicious client could attempt to alter `chat_id`, `sender_id`, `attachment`, or `poll`, bypassing UI-only restrictions. | **Mitigation added** in `supabase/migrations/20261101_message_column_permissions.sql`: revoke table UPDATE and grant only body/edit/effect/delete-marker columns. Test on staging before rollout. |
| **High — verify** | Security hardening revokes EXECUTE from every function in `public` | It restores only a small allow-list. Other legitimate deployed RPCs could stop working; repository schema may differ from the live database. | Inventory actual public functions and smoke-test staging before applying. |
| **High — verify** | Polls are stored as JSON on message rows | Vote integrity depends on the server RPC and preventing direct poll updates. Malformed poll JSON, forged initial votes, option switching and concurrent voting require database tests. | Partial defense added; integration tests still required. |
| **Medium** | Missing Supabase configuration bypasses the auth gate | `AuthGate.tsx` renders the app without a session if Supabase is unconfigured. Useful for local demo, but a production misconfiguration can display demo data as if it were a real service. | Make production fail closed; label demo mode explicitly in development. |
| **Medium** | Profile directory is broadly readable to authenticated users | RLS uses `using (true)` for profile SELECT. Currently selected fields are basic identity data, but enumeration is possible and future profile fields could widen exposure. | Limit searchable fields and consider opt-in discoverability/rate limits. |
| **Medium** | Group invite codes do not expire or rotate in the inspected migration | A leaked link remains a bearer credential until manually changed. | Add revocation/rotation, optional expiry and join rate limiting. |
| **Medium** | Storage delete policy lacks membership check | Delete checks uploader folder but not current membership in the chat represented by the path. A former member may be able to delete their own object after leaving. | Require uploader ownership and current chat membership; validate object path shape. |
| **Medium** | Direct-chat creation can race | `create_direct_chat` checks for an existing pair and then inserts without an obvious uniqueness/serialization guard; simultaneous calls may create duplicates. | Add a concurrency-safe pair key or transaction/advisory-lock strategy. |
| **Medium** | Client-provided MIME/metadata is not proof of file type | Storage MIME allow-list and size cap are useful, but MIME can be spoofed. | Validate metadata and file signatures where practical; consider malware scanning for public use. |
| **Medium** | No E2EE implementation found | Cloud messages rely on Supabase/server access controls. This is not end-to-end encryption and should not be marketed as such. | If needed, design with a reviewed protocol/library and a threat model; do not invent crypto. |
| **Low / operational** | Lockfile is out of sync with package.json | Lockfile root misses `@supabase/supabase-js`; `npm ci` previously failed. CI's `npm install` workaround can hide lock drift. | Regenerate and commit lockfile, then restore `npm ci`. |
| **Low / scale** | Client loads up to 1000 messages and performs extra reaction queries | History and reactions can become slow and costly as chats grow. | Cursor pagination, batched reaction queries, indexes and load tests. |

## Mitigation added

`20261101_message_column_permissions.sql` revokes table-level UPDATE on `messages` for authenticated clients and grants only `body`, `edited_at`, `effect`, and `deleted_at`. Poll updates should go through the explicit RPC. This is defense-in-depth, not a complete security certification.

## Before production

1. Apply migrations only to a staging Supabase project first.
2. Test anonymous access, cross-chat reads/writes, sender spoofing, membership removal, storage read/delete, and invite abuse with separate accounts.
3. Test poll creation/voting with malformed JSON, repeated votes, option switching and concurrent requests.
4. Inventory all public functions in the actual database before broad EXECUTE revocation.
5. Regenerate lockfile; run `npm ci`, `npm audit --omit=dev`, `npm run build` and automated tests.
6. Verify OAuth redirect allow-list, Auth rate limits, Storage policies, backup/PITR configuration and GitHub Actions permissions.
7. Add a production health check that refuses to present demo data as a live account if Supabase is misconfigured.

## Limitations

No live Supabase project was queried; database policies were not exercised under real roles; no DAST, load test, restore drill or formal privacy review was performed. Items marked “verify” are risks requiring confirmation, not confirmed production exploits.
