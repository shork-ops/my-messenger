# Reliability rollout

## What can ship with the frontend

Direct chats are identified by peer UUID, with a server lookup for older cached chats that have no peer UUID. Avatar URLs refresh before expiry and after the browser reconnects. Peer photos are reloaded through profile updates and a one-minute polling fallback. Text/sticker messages have sending/failed/accepted states, a stable UUID and a per-account durable outbox. A network retry cannot create a second row with the same UUID.

## Server update

Deployed on 2026-10-31 to project `wuifyiqnkpridblufxzs`.

To repeat it from this repository:

```sh
npx supabase login
npx supabase db push --include-all     # 20261048..20261051
npm run deploy:reliability             # functions
```

The script uses the project reference from `supabase/config.toml`. To validate on staging first, set `SUPABASE_PROJECT_REF` to that project's reference. It applies **only** `20261050_view_once.sql`, then deploys `cleanup-media` and `view-once`; it does not replay old migrations. `db push --include-all` is what applied the whole pending set. No database password or service-role secret needs to be pasted into chat.

### Two migrations never ran anywhere

`20261048`–`20261051` were written but never applied: the CLI was not authenticated, so the failures below were never seen. Applying them the first time failed twice on `20261049_channels.sql`:

- `or m.is_admin` referred to a column that does not exist. Membership roles live in `chat_members.role` (`owner`, `member`).
- A regex literal was split across two lines, and a `$$` was written as `$` twice.

A migration that has never been executed is not a migration that works. Both are fixed, and the set now applies cleanly.

The maintenance scheduler must send `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` to cleanup-media. A normal user token is refused. Never put this key in the frontend.

## Single-view media

- New files go into a dedicated private bucket with no authenticated SELECT policy.
- Only a current non-sender chat member can claim a message; missing/deleted/future messages and blocked pairs are refused.
- A receipt is stored per user and message under a primary key. Clearing browser storage, using another device or racing requests cannot reset it.
- The Edge Function issues one ten-second signed URL after a successful claim. A failed network response may consume the view: privacy is preferred over replaying a URL.
- The message row contains no inline thumbnail or full image. Generic media refresh and galleries exclude single-view media.
- The frontend checks server readiness before upload. Until migration and function deployment succeed, ordinary photos work but new single-view sends fail closed with an explanation.
- Previously sent single-view photos used the ordinary bucket and may already have shared bytes or an hour-long URL. They cannot be retroactively made confidential; the new opening endpoint refuses that legacy format. Resend those photos after server deployment if needed.
- A receiver can still save bytes or take a screenshot. Server-side single-view limits new access; it cannot erase a copy already obtained.

## Verification

```sh
npm ci
npm run build
npm test
npm run test:db
npm run test:e2e
```

`test:db` runs the receipt/permissions migration on PostgreSQL via PGlite with authenticated A/B/outsider identities. The fixture is not a running Supabase deployment; Storage HTTP signing and real device behaviour still require staging validation.

### Staging two-account checklist

1. A and B choose identical display names. B searches A by username and creates a dialog. Check the peer UUID and photo, not the shared name.
2. A changes/removes their photo. B sees the change without reloading; after an hour B's photo link remains valid. Repeat after restoring a background tab.
3. Disconnect B while sending. Check sending/error states, restart the page and retry. A receives one message, including when the first response was lost.
4. Send a single-view photo A → B. The image must not be present in the message JSON. Open it as B. B's second browser must be refused, and outsider C must never obtain a link. The sender cannot consume B's view.
5. Anonymous/normal-user calls to cleanup-media return 401 and do not list or delete objects. The maintenance token works. Album files remain referenced.
6. On physical Android/iOS devices, test keyboard, background/resume, weak network, upload, calls and media permissions. These cannot be certified by desktop viewport tests alone.
