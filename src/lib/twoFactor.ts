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
  return "Выключена — вход только по паролю";
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
