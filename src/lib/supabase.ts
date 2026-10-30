import { createClient } from "@supabase/supabase-js";
import { ACTIVE_SLOT_KEY, DEFAULT_SLOT, storageKeyForSlot } from "./accounts";

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
 * The storage key of the account in use.
 *
 * Read once at startup, before any session is restored: two accounts cannot share one key,
 * because the second sign-in would overwrite the first. Switching accounts therefore means
 * choosing a different key and reloading - not signing out and back in, which would lose the
 * session that was already there.
 */
export function activeStorageKey(): string {
  if (typeof window === "undefined") return storageKeyForSlot(DEFAULT_SLOT);
  try {
    return storageKeyForSlot(window.localStorage.getItem(ACTIVE_SLOT_KEY) || DEFAULT_SLOT);
  } catch {
    return storageKeyForSlot(DEFAULT_SLOT);
  }
}

/**
 * Browser-safe Supabase client. Only use the publishable key here.
 * The app can still start in local-demo mode until deployment secrets are configured.
 */
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        storageKey: activeStorageKey(),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
