/**
 * Signing in with a one-time code sent by email.
 *
 * Google stays the first option; email exists for people who have no Google account or do not
 * want to tie the messenger to one. The same Supabase account is used either way: an address
 * that already signed in through Google gets the same user, not a second one.
 *
 * Everything here is plain logic so the sign-in screen can stay layout and the rules can be
 * tested without a browser.
 */

/** Supabase refuses a second email to the same address for about a minute. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Supabase sends 6 digits by default; the project setting allows up to 10. */
export const EMAIL_CODE_MIN_LENGTH = 6;
export const EMAIL_CODE_MAX_LENGTH = 10;

/** Addresses are compared without case, and a pasted address often carries spaces. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A deliberately loose check: one @, something on both sides, a dot in the domain.
 *
 * The real check is whether the letter arrives. A strict pattern would only reject unusual but
 * valid addresses, so this catches typos like a missing @ and nothing more.
 */
export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Keeps only digits, so a code pasted as "123 456" or "123-456" still works. */
export function normalizeCode(raw: string, maxLength: number = EMAIL_CODE_MAX_LENGTH): string {
  return raw.replace(/\D/g, "").slice(0, maxLength);
}

export function isCodeComplete(code: string): boolean {
  return code.length >= EMAIL_CODE_MIN_LENGTH && code.length <= EMAIL_CODE_MAX_LENGTH && /^\d+$/.test(code);
}

/** "0:45" for the resend button. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

type AuthErrorLike = { code?: string | null; status?: number | null; message?: string | null } | null | undefined;

/**
 * What to tell a person when Supabase says no.
 *
 * Supabase answers in English and in its own terms ("otp_expired"); the screen needs one plain
 * sentence that says what to do next. Unknown errors get a generic line rather than the raw
 * English text.
 */
export function signInErrorMessage(error: AuthErrorLike): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429 || message.includes("rate limit")) {
    return "Слишком много попыток подряд. Подожди минуту и попробуй снова.";
  }
  if (code === "email_address_invalid" || (message.includes("email address") && message.includes("invalid"))) {
    return "Проверь адрес почты — похоже, в нём опечатка.";
  }
  if (code === "otp_expired" || message.includes("token has expired") || message.includes("otp has expired")) {
    return "Код не подошёл или устарел. Проверь цифры или запроси новый код.";
  }
  if (code === "mfa_verification_failed" || message.includes("invalid totp")) {
    return "Неверный код. Введи текущий код из приложения-аутентификатора.";
  }
  if (code === "mfa_challenge_expired") {
    return "Время на ввод кода вышло. Введи новый код из приложения.";
  }
  if (code === "signup_disabled" || message.includes("signups not allowed")) {
    return "Регистрация по почте сейчас закрыта. Войди через Google.";
  }
  if (code === "email_provider_disabled" || code === "otp_disabled" || message.includes("email logins are disabled")) {
    return "Вход по почте пока не включён. Войди через Google.";
  }
  if (code === "email_address_not_authorized" || message.includes("error sending") || message.includes("sending magic link")) {
    return "Не удалось отправить письмо. Попробуй позже или войди через Google.";
  }
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Нет связи с сервером. Проверь интернет и попробуй снова.";
  }
  return "Не получилось войти. Попробуй ещё раз.";
}
