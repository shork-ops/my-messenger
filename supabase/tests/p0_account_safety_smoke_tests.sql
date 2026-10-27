-- Manual SQL smoke tests for P0 account safety migration.
-- Run in a disposable Supabase staging project while authenticated as test users.
-- Never run the setup/destructive sections against production data.

-- 1) Anonymous access must fail:
-- select * from public.user_blocks;
-- select * from public.user_reports;

-- 2) Authenticated user A can insert/list/delete only their own blocks.
-- INSERT INTO public.user_blocks(blocker_id, blocked_id)
-- VALUES (auth.uid(), '<test-user-b-uuid>');
-- Expected: allowed for A; selecting B's blocker_id rows and deleting another user's block must return 0 rows.

-- 3) A user cannot submit a report as another reporter or report themselves.
-- INSERT INTO public.user_reports(reporter_id, reported_user_id, reason)
-- VALUES ('<other-user-uuid>', '<test-user-b-uuid>', 'spam');
-- Expected: RLS violation.
-- INSERT INTO public.user_reports(reporter_id, reported_user_id, reason)
-- VALUES (auth.uid(), auth.uid(), 'spam');
-- Expected: constraint/RLS violation.

-- 4) Only group owners/admins can rotate/revoke invite links.
-- SELECT * FROM public.rotate_group_invite('<group-chat-uuid>', 24);
-- SELECT public.revoke_group_invite('<group-chat-uuid>');
-- Expected: members receive an exception; admins get a new code/expiry; revoked/expired codes cannot join.

-- 5) Existing links remain valid if invite_expires_at is NULL and invite_revoked_at is NULL.
-- Decide whether to backfill existing invites with an expiry before production rollout.
