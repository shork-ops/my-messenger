import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

/**
 * Resolved endpoint and publishable key.
 *
 * Exported because Edge Functions can be called with fetch rather than through
 * the client, and re-reading import.meta.env elsewhere is how the call token
 * request ended up looking at a variable name the app never sets.
 */
export const supabaseConfig = { url: supabaseUrl ?? "", publishableKey: supabasePublishableKey ?? "" };

/**
 * Browser-safe Supabase client. Only use the publishable key here.
 * The app can still start in local-demo mode until deployment secrets are configured.
 */
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
