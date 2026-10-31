# Verified cloud state — 2026-10-31 (probe, not a claim from a document)

Measured from this machine against project `wuifyiqnkpridblufxzs` with the **publishable key
only**. No service-role key and no user credentials exist in this workspace, so every statement
below is what an *unauthenticated* caller sees. Nothing here used a secret, and no secret is
recorded.

## Reachability

- `https://wuifyiqnkpridblufxzs.supabase.co` responds (401 without a key, as expected).
- Publishable key works for PostgREST and Auth.

## Migrations (as evidenced by PostgREST)

| Object | Result | Means |
| --- | --- | --- |
| `profiles`, `chats`, `messages` | readable (empty under RLS) | base schema applied |
| `content_reports` | table exists, 0 rows under RLS | `20261051_content_reports.sql` applied |
| `view_once_receipts` | exists but `select=id` is 400 (no `id` column; PK is `message_id,user_id`) | `20261050_view_once.sql` applied, RLS denies anon |
| `device_sessions` | `PGRST205` not found | **not deployed — this task adds it** |
| `game_sessions` | `PGRST205` not found | **not deployed — this task adds it** |

So the `docs/RELIABILITY_ROLLOUT.md` statement that `20261048`–`20261051` were deployed holds,
and is now confirmed rather than assumed.

## Edge Functions (anonymous call)

| Function | Status | Meaning |
| --- | --- | --- |
| `view-once` | 401 `Authentication required` | deployed, refuses anon |
| `cleanup-media` | 401 `Unauthorized` | deployed, refuses anon |
| `delete-account` | 401 `Authentication required` | deployed, refuses anon |
| `call-token` | 401 `Authentication required` | deployed, refuses anon |
| `link-preview` | 401 `auth` | deployed, refuses anon |
| `push-notify` | no HTTP status (webhook, `verify_jwt=false`) | deployed |

403-vs-401 matters: a 404 would mean "not deployed". Every function answers with an auth
refusal, so all of them exist in the cloud.

## RPCs

- `view_once_capabilities()` → `42501 permission denied for function`, i.e. **exists** and is
  revoked from `anon`. (A missing function returns `PGRST202` instead.)
- `claim_view_once_message(uuid)`, `is_chat_member(uuid)`, `game_list_sessions()`,
  `device_list_sessions()` → `PGRST202` because the probe passed `{}` with no arguments; this is
  a probe limitation, not evidence of absence.

## Anonymous RLS results

`profiles`, `chats`, `messages`, `content_reports` all return **0 rows** to an anonymous caller,
and `cleanup-media` returns **401**. RLS is enforcing.

## What is still unverifiable without the user

- Anything behind a real session: cross-user chat reads, single-view as a second session, report
  spam limits, owning-device listing and revocation, and the authenticated half of every Edge
  Function. **Google OAuth is the only enabled provider**, `disable_signup=false` but email
  delivery is unconfirmed, and there are no QA credentials or service-role key in the workspace.
- Creating users would require the service-role key, which this task must not change, or a
  Google sign-in, which needs the user.
- Signing up a throwaway address would write a real user into the shared project; not done
  without being asked.

## Consequence for the plan

Point 7's *server-side* assertions are therefore prepared as code plus PostgreSQL (PGlite) tests
that run locally, with the deployed-vs-prepared split stated explicitly in the final report. The
authenticated cloud run is listed as requiring user access.
