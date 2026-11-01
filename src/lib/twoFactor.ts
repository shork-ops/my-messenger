/**
 * Two-factor authentication through an authenticator app (TOTP).
 *
 * The secret never leaves the device except to Supabase, which stores the factor.
 * This module only prepares and validates what the user types; enrolling and
 * verifying happen in the client and are checked on the server, so a modified app
 * cannot declare itself verified.
 */

/** The shape Supabase returns when a TOTP factor is enrolled. */
export type TotpEnrollment = {
  /** The base32 secret, shown as a fallback when the QR will not scan. */
  secret: string;
  /** The otpauth:// URI, which the QR code encodes. */
  uri: string;
};

/** A six-digit code from an authenticator app. */
export const TOTP_CODE_LENGTH = 6;

export function isValidTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/**
 * Splits the otpauth URI into the parts a person needs to type by hand.
 *
 * The issuer and account are read from the URI rather than rebuilt from the
 * profile, because an authenticator shows what is in the URI: if the app guessed a
 * different name, people would see two entries that look unlike each other.
 */
export function describeTotpUri(uri: string): { issuer: string; account: string; secret: string } | null {
  if (!uri.startsWith("otpauth://totp/")) return null;
  const [path, query = ""] = uri.slice("otpauth://totp/".length).split("?");
  const params = new URLSearchParams(query);
  const account = decodeURIComponent(path);
  const issuerParam = params.get("issuer");
  const [issuerFromPath, accountFromPath] = account.includes(":")
    ? [account.slice(0, account.indexOf(":")), account.slice(account.indexOf(":") + 1)]
    : ["", account];
  return {
    issuer: issuerParam ?? issuerFromPath,
    account: accountFromPath,
    secret: params.get("secret") ?? "",
  };
}

/**
 * Groups a base32 secret for reading aloud.
 *
 * A raw secret is one long run of capitals; in groups of four it can be checked
 * against the screen without losing place.
 */
export function formatSecret(secret: string): string {
  const clean = secret.replace(/\s+/g, "").toUpperCase();
  return clean.replace(/(.{4})(?=.)/g, "$1 ");
}

/** What to say about a factor's state on the settings row. */
export function factorSummary(status: "verified" | "unverified" | null): string {
  if (status === "verified") return "Включена — код спрашивается при входе";
  if (status === "unverified") return "Незавершённое подключение";
  return "Выключена — для входа хватает Google или кода из письма";
}

/**
 * Whether a new sign-in still needs the second step.
 *
 * Required when a verified factor exists and the current session has not reached
 * aal2 yet. This is what stops an attacker with the password alone.
 */
export function needsSecondFactor(verifiedFactors: number, currentLevel: "aal1" | "aal2" | null): boolean {
  return verifiedFactors > 0 && currentLevel !== "aal2";
}

/**
 * The assurance level written into a Supabase access token ("aal1" or "aal2").
 *
 * Read from the token itself because that is what the server checks. A token that cannot be
 * read counts as no level at all, which keeps the second step in place for anyone who has a
 * factor.
 */
export function accessLevel(accessToken: string | null | undefined): "aal1" | "aal2" | null {
  if (!accessToken) return null;
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64)) as { aal?: unknown };
    return payload.aal === "aal1" || payload.aal === "aal2" ? payload.aal : null;
  } catch {
    return null;
  }
}

type SessionLike = {
  access_token: string;
  user?: { factors?: Array<{ id: string; factor_type: string; status: string }> | null } | null;
};

/**
 * The factor to ask for before the app opens, or null when no second step is needed.
 *
 * Without this check the setting only enrolled a factor: a fresh sign-in through Google or an
 * email code went straight into the chats although the settings screen promised a code.
 */
export function secondFactorFor(session: SessionLike | null | undefined): string | null {
  if (!session) return null;
  const verified = (session.user?.factors ?? []).filter((factor) => factor.factor_type === "totp" && factor.status === "verified");
  if (!needsSecondFactor(verified.length, accessLevel(session.access_token))) return null;
  return verified[0]?.id ?? null;
}
