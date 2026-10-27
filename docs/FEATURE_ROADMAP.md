# Nexus Messenger — competitive gap analysis and roadmap

Compared with WhatsApp, Signal, Telegram and Discord as representative mainstream messengers. Current competitor features should be rechecked against official documentation before implementation decisions.

## Current snapshot

From repository evidence: responsive dark web UI; Google OAuth via Supabase; profile/username lookup; direct/group chats and invite codes; text messages; attachments; reactions; replies; edit/delete markers; message effects; polls; Supabase Realtime. Browser-first prototype, not a mature cross-platform service.

## Capability comparison

| Area | Nexus now | Mature messenger baseline | Gap |
|---|---|---|---|
| Identity/security | Google OAuth, RLS and Storage policies | Account recovery, session/device management, abuse protection, stronger login options | **P0:** recovery, session controls, account deletion |
| Messaging | Text, replies, edit/delete markers, reactions | Delivery/read state, pins, mentions, forwarding, search | **P1:** receipts, pins, mentions, search |
| Groups | Group chats, invite code | Admin/member tools, granular permissions, moderation, ownership transfer | **P0:** admin tools, invite expiry/revocation |
| Files | Private bucket, 50 MB cap in migration | Upload retries, previews, shared media, quotas and abuse controls | **P1:** progress/retry/gallery and validation |
| Polls | JSON-backed poll and RPC voting | Closing/deadlines, reliable concurrent voting, flexible poll types | **P1:** normalize votes and test concurrency |
| Notifications | Notification icon in UI; push pipeline not confirmed | Push, mute per chat, mention-only notifications | **P1:** web push and per-chat controls |
| Voice/video | UI icons exist; no calling implementation found | Reliable 1:1/group calls, device switching, call links | **P2:** WebRTC after core reliability |
| Privacy | Cloud database model; no E2EE found | Signal/WhatsApp E2EE by default; Telegram separates cloud chats and Secret Chats | **P0:** accurate claims; **P2:** vetted E2EE design |
| History/search | Up to 1000 messages per fetch; full search not confirmed | Indexed search, filters, pagination, long history | **P1:** cursor pagination and search |
| Communities | Basic groups | Telegram topics/channels; Discord servers/channels/roles/moderation | **P2:** topics, roles, moderation |
| Accessibility | Custom responsive CSS; needs QA | Keyboard/screen-reader support, reduced motion, mature mobile UX | **P1:** accessibility and mobile-browser audit |
| Reliability | CI build, dependency audit and CodeQL on security branch | Monitoring, restore-tested backups, incident response and SLOs | **P0:** monitoring, restore drill, deployment health |

## Roadmap

### P0 — Security and reliability
1. Validate the security migration sequence against staging and add automated RLS/storage integration tests.
2. Commit a clean `package-lock.json`; restore deterministic `npm ci` in CI.
3. Fail closed in production when Supabase config is missing; demo mode must be explicit.
4. Add blocking/reporting, invite revocation/expiry, rate limits, account deletion and data export.
5. Set up error monitoring, backups, restore drills and deployment health checks.

### P1 — Everyday messenger basics
1. Cursor-based history pagination and searchable messages.
2. Delivery/read receipts and unread counts.
3. Pinned messages, mentions, per-chat mute and browser push notifications.
4. Media previews, upload progress/retry and shared-media gallery.
5. Group admin/member management and ownership transfer.
6. Accessibility, keyboard navigation, reduced-motion settings and mobile testing.

### P2 — Differentiation
1. WebRTC voice/video calls with call links and network-quality handling.
2. Group topics/threads and richer moderation.
3. Installable PWA, multi-device/session management, later native clients.
4. E2EE only after a written threat model and adoption of a reviewed protocol/library, including key verification, multi-device lifecycle, recovery trade-offs and abuse-reporting design.
5. Optional encrypted backups/export with clear recovery-key UX.

## Competitive reference points

- **WhatsApp:** end-to-end encryption by default and account protections such as passkeys/two-step verification.
- **Signal:** privacy-first messaging, disappearing messages, calls, screen lock and encrypted backup/device-transfer options.
- **Telegram:** cloud sync, usernames, large groups/channels, moderation, search and topics; Secret Chats are a separate E2EE mode.
- **Discord:** community servers, channels, roles, moderation and voice/video-oriented collaboration.

Nexus should not try to clone all four at once. A sensible initial position is a polished private/community messenger with reliable sync, strong account controls, small-group administration and fast search. Until E2EE is implemented and reviewed, do not claim that message contents are unreadable to the service operator.

## Metrics to define

- Message send success and median/p95 delivery latency.
- Realtime reconnect success and recovery from missed events.
- Uncaught-error rate.
- Attachment upload completion and failure reasons.
- Search latency at 10k and 100k messages.
- Unauthorized-access test coverage per table and storage policy.
- Account recovery success and abuse-report handling time.

## Official reference sources

- WhatsApp account security update (Meta, 25 August 2026): https://about.fb.com/news/2026/08/new-account-security-features-for-whatsapp/
- Signal backup and device-transfer support: https://support.signal.org/hc/en-us/articles/10074659364122-Backups-and-Device-Transfers-on-Signal
- Telegram FAQ (cloud chats, Secret Chats, groups and channels): https://www.telegram.org/faq
- Telegram privacy policy: https://telegram.org/privacy/
