# P0 hardening implementation status

This branch contains incremental work for the P0 checklist. It is not a declaration that production is fully secure.

## Implemented in code

- Production AuthGate now fails closed when Supabase is not configured; local development can still use demo mode.
- AuthGate exposes a local-session sign-out action.
- Added migration `20261102_account_safety_controls.sql` with user block records, user reports, and owner/admin-only invite rotation/revocation plus expiry-aware joining.
- Added an authenticated Supabase Edge Function for deleting the currently authenticated user's Auth account, with explicit confirmation.
- Added SQL smoke-test scenarios for RLS and invite controls.
- Security workflow now runs for feature-branch pushes and pull requests, rather than only PRs targeting main.

## Not yet complete

1. **Lockfile:** The repository lockfile omits `@supabase/supabase-js` and its dependency tree. This environment cannot reach npm/GitHub package registries, so I could not safely generate a valid lockfile. Do not hand-edit the transitive dependency tree. Run `npm install --package-lock-only` with Node 20/npm in a network-enabled checkout, review the diff, then verify `npm ci` and restore `npm ci` in both workflows.
2. **Blocking:** The migration stores block relationships, but the UI and send/receive policies are not yet wired to enforce blocking behavior. Do not present blocking as fully functional until that is implemented and tested.
3. **Reports:** Users can submit reports, but moderator review tooling and retention policy are not implemented.
4. **Account deletion:** The Edge Function is added but deliberately not connected to a user-facing irreversible button. Deploy it to staging, implement re-authentication/confirmation and storage-object cleanup, then test cascade behavior.
5. **Account recovery/session management:** Sign-out is added. Login uses Google OAuth, so credential recovery is handled through Google; session/device listing and revocation of all other sessions are not implemented.
6. **Monitoring and backups:** GitHub Actions provides build/security checks, not runtime monitoring. Configure Sentry (or an equivalent) with a DSN and privacy review; configure Supabase backups/PITR as appropriate and perform a documented restore drill. No live production setting can be changed from this repository-only workflow.
7. **Database validation:** No staging Supabase credentials were available, so migrations and RLS tests have not been executed against a live database.

## Safe rollout order

1. Create a disposable Supabase staging project and apply migrations in order.
2. Verify all public RPCs before applying the broad EXECUTE-revocation migration.
3. Run the SQL smoke tests with two authenticated users and an anonymous client.
4. Verify the app still builds and all chat/group/poll/media operations work.
5. Finish the lockfile in a network-enabled environment and require `npm ci`.
6. Only then consider production rollout.
