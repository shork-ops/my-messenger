# Account deletion Edge Function

Deploy with Supabase CLI:

```sh
supabase functions deploy delete-account
supabase secrets set ALLOWED_APP_ORIGIN=https://shork-ops.github.io
```

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never expose the service-role key in the browser.

The function validates the caller's bearer token with `auth.getUser()`, requires an explicit confirmation string, and deletes only the authenticated user's Auth account. Database rows with foreign keys configured `ON DELETE CASCADE` are removed by Postgres; verify every table/storage object relationship before enabling this in production. Storage objects are not automatically deleted by all FK cascades, so add a cleanup job for user-owned media before advertising complete erasure. Test on staging and review applicable retention/legal requirements first.

This endpoint is intentionally not wired to a client-facing button yet: account deletion is irreversible and the UI needs a confirmation/re-authentication flow plus storage cleanup before release.
