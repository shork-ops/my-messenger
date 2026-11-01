import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { supabase } from "./supabase";
import { authBaseStyles } from "./authStyles";
import {
  EMAIL_CODE_MAX_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  formatCountdown,
  isCodeComplete,
  isValidEmail,
  normalizeCode,
  normalizeEmail,
  signInErrorMessage,
} from "./signIn";
import { TOTP_CODE_LENGTH, isValidTotpCode } from "./twoFactor";

/**
 * The sign-in forms: Google, a one-time code by email, and the authenticator step.
 *
 * Loaded on demand by AuthGate. Someone who is already signed in never downloads them, which
 * keeps the first screen of the app inside its size budget.
 */

/** Where Google and the link in the letter return to: the app itself, wherever it is served. */
function returnUrl(): string {
  return window.location.origin + window.location.pathname;
}

/** Inline styles have no :disabled, so a disabled control is dimmed by hand. */
function dimmed(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.5, cursor: "default" } : style;
}

type Busy = "google" | "send" | "verify" | null;

export function SignInScreen({ initialError }: { initialError: string }) {
  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState(initialError);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const signInWithGoogle = async () => {
    if (!supabase) return;
    setBusy("google");
    setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: returnUrl(),
        queryParams: { prompt: "select_account" },
      },
    });
    if (authError) {
      setError(signInErrorMessage(authError));
      setBusy(null);
    }
  };

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!supabase || busy) return;
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) {
      setError("Проверь адрес почты — похоже, в нём опечатка.");
      return;
    }
    setBusy("send");
    setError("");
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true, emailRedirectTo: returnUrl() },
    });
    setBusy(null);
    if (otpError) {
      setError(signInErrorMessage(otpError));
      return;
    }
    setEmail(address);
    setCode("");
    setStep("code");
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || busy || !isCodeComplete(code)) return;
    setBusy("verify");
    setError("");
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (verifyError) {
      setBusy(null);
      setError(signInErrorMessage(verifyError));
    }
    // On success the session arrives through onAuthStateChange and this screen goes away.
  };

  const changeEmail = () => {
    setStep("start");
    setCode("");
    setError("");
  };

  if (step === "code") {
    return (
      <main style={styles.page}>
        <section style={styles.card}>
          <div style={styles.mark}>N</div>
          <p style={styles.eyebrow}>NEXUS MESSENGER</p>
          <h1 style={styles.title}>Проверь почту</h1>
          <p style={styles.subtitle}>
            Отправили письмо на <strong style={styles.strong}>{email}</strong>. Введи код из него или открой ссылку из
            письма в этом браузере.
          </p>
          <form onSubmit={verifyCode} style={styles.form} noValidate>
            <label style={styles.label} htmlFor="auth-email-code">
              Код из письма
            </label>
            <input
              id="auth-email-code"
              style={{ ...styles.input, ...styles.codeInput }}
              value={code}
              onChange={(event) => setCode(normalizeCode(event.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={EMAIL_CODE_MAX_LENGTH}
              placeholder="123456"
              autoFocus
            />
            <button type="submit" style={dimmed(styles.primary, busy !== null || !isCodeComplete(code))} disabled={busy !== null || !isCodeComplete(code)}>
              {busy === "verify" ? "Проверяем…" : "Войти"}
            </button>
          </form>
          {error && <p role="alert" style={styles.error}>{error}</p>}
          <div style={styles.linkRow}>
            <button type="button" style={dimmed(styles.link, busy !== null || cooldown > 0)} onClick={() => void sendCode()} disabled={busy !== null || cooldown > 0}>
              {cooldown > 0 ? `Отправить ещё раз через ${formatCountdown(cooldown)}` : busy === "send" ? "Отправляем…" : "Отправить ещё раз"}
            </button>
            <button type="button" style={styles.link} onClick={changeEmail} disabled={busy === "verify"}>
              Изменить почту
            </button>
          </div>
          <p style={styles.footnote}>Письма нет? Проверь папку «Спам» — первое письмо иногда попадает туда.</p>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.mark}>N</div>
        <p style={styles.eyebrow}>NEXUS MESSENGER</p>
        <h1 style={styles.title}>Твои люди. Твои чаты.</h1>
        <p style={styles.subtitle}>Войди через Google или по коду из письма.</p>
        <button type="button" onClick={signInWithGoogle} disabled={busy !== null} style={styles.button}>
          <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 5) scale(.9)"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.42 37.97 46.98 31.84 46.98 24.55Z" transform="translate(1 1) scale(.94)"/>
            <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z" transform="translate(4 2) scale(.9)"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.45-4.89 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 0) scale(.9)"/>
          </svg>
          {busy === "google" ? "Переходим к Google…" : "Продолжить с Google"}
        </button>
        <div style={styles.divider} aria-hidden="true">
          <span style={styles.dividerLine} />
          или
          <span style={styles.dividerLine} />
        </div>
        <form onSubmit={sendCode} style={styles.form} noValidate>
          <label style={styles.label} htmlFor="auth-email">
            Почта
          </label>
          <input
            id="auth-email"
            type="email"
            style={styles.input}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@example.com"
          />
          <button type="submit" style={dimmed(styles.primary, busy !== null || email.trim() === "")} disabled={busy !== null || email.trim() === ""}>
            {busy === "send" ? "Отправляем код…" : "Получить код"}
          </button>
        </form>
        {error && <p role="alert" style={styles.error}>{error}</p>}
        <p style={styles.footnote}>
          Пароль Google остаётся у Google. Новый аккаунт создаётся при первом входе — через Google или по почте.
        </p>
      </section>
    </main>
  );
}

/**
 * The authenticator step after Google or an email code.
 *
 * Signing out is offered because the person on this screen may simply be on the wrong account,
 * and without a way back the only exit would be clearing the browser.
 */
export function SecondFactorScreen({ factorId }: { factorId: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || busy || !isValidTotpCode(code)) return;
    setBusy(true);
    setError("");
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (verifyError) {
      setBusy(false);
      setCode("");
      setError(signInErrorMessage(verifyError));
    }
    // On success Supabase stores the stronger session and AuthGate lets the app open.
  };

  const signOut = async () => {
    if (!supabase) return;
    setBusy(true);
    await supabase.auth.signOut({ scope: "local" });
  };

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.mark}>N</div>
        <p style={styles.eyebrow}>NEXUS MESSENGER</p>
        <h1 style={styles.title}>Ещё один шаг</h1>
        <p style={styles.subtitle}>Включена двухфакторная защита. Введи код из приложения-аутентификатора.</p>
        <form onSubmit={verify} style={styles.form} noValidate>
          <label style={styles.label} htmlFor="auth-totp-code">
            Код из приложения
          </label>
          <input
            id="auth-totp-code"
            style={{ ...styles.input, ...styles.codeInput }}
            value={code}
            onChange={(event) => setCode(normalizeCode(event.target.value, TOTP_CODE_LENGTH))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={TOTP_CODE_LENGTH}
            placeholder="123456"
            autoFocus
          />
          <button type="submit" style={dimmed(styles.primary, busy || !isValidTotpCode(code))} disabled={busy || !isValidTotpCode(code)}>
            {busy ? "Проверяем…" : "Подтвердить"}
          </button>
        </form>
        {error && <p role="alert" style={styles.error}>{error}</p>}
        <div style={styles.linkRow}>
          <button type="button" style={styles.link} onClick={() => void signOut()} disabled={busy}>
            Выйти и войти в другой аккаунт
          </button>
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  ...authBaseStyles,
  strong: { color: "#f4f4f5", overflowWrap: "anywhere" },
  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    width: "100%",
    minHeight: 52,
    marginTop: 28,
    padding: "0 18px",
    border: "1px solid #dedee2",
    borderRadius: 12,
    background: "#fff",
    color: "#171717",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "22px 0 18px",
    color: "#7d7e86",
    fontSize: 12,
  },
  dividerLine: { flex: 1, height: 1, background: "#303136" },
  form: { display: "grid", gap: 10, textAlign: "left" },
  label: { color: "#a6a7ae", fontSize: 12, fontWeight: 600 },
  input: {
    width: "100%",
    minHeight: 48,
    padding: "0 14px",
    border: "1px solid #3a3b41",
    borderRadius: 12,
    background: "#141518",
    color: "#f4f4f5",
    fontSize: 16,
    boxSizing: "border-box",
  },
  codeInput: { textAlign: "center", letterSpacing: 6, fontSize: 20, fontVariantNumeric: "tabular-nums" },
  primary: {
    width: "100%",
    minHeight: 48,
    padding: "0 18px",
    border: "none",
    borderRadius: 12,
    background: "#ffd400",
    color: "#101010",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  },
  linkRow: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 4, marginTop: 12 },
  link: {
    minHeight: 44,
    padding: "0 10px",
    border: "none",
    background: "transparent",
    color: "#ffd400",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { marginTop: 16, color: "#ff8585", fontSize: 12, overflowWrap: "anywhere" },
  footnote: { margin: "24px 0 0", color: "#a6a7ae", fontSize: 12, lineHeight: 1.6 },
};

