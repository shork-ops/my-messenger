import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";
import { isDemoMode } from "./constants";

type AuthGateProps = { children: ReactNode };

export default function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isDemoMode) {
      setLoading(false);
      return;
    }
    if (!supabase || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      setError("");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    if (!supabase) return;
    setSigningIn(true);
    setError("");
    const redirectTo = window.location.origin + window.location.pathname;
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });
    if (authError) {
      setError(authError.message);
      setSigningIn(false);
    }
  };

  // Demo mode runs entirely on local data, so there is nothing to authenticate.
  if (isDemoMode) return <>{children}</>;
  if (!isSupabaseConfigured || !supabase) return <>{children}</>;
  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.mark}>N</div>
          <p style={styles.subtitle}>Проверяем авторизацию…</p>
        </div>
      </main>
    );
  }
  if (session) return <>{children}</>;

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.mark}>N</div>
        <p style={styles.eyebrow}>NEXUS MESSENGER</p>
        <h1 style={styles.title}>Твои люди. Твои чаты.</h1>
        <p style={styles.subtitle}>Войди через Google, чтобы продолжить.</p>
        <button type="button" onClick={signInWithGoogle} disabled={signingIn} style={styles.button}>
          <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 5) scale(.9)"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.42 37.97 46.98 31.84 46.98 24.55Z" transform="translate(1 1) scale(.94)"/>
            <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z" transform="translate(4 2) scale(.9)"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.45-4.89 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 0) scale(.9)"/>
          </svg>
          {signingIn ? "Переходим к Google…" : "Продолжить с Google"}
        </button>
        {error && <p role="alert" style={styles.error}>{error}</p>}
        <p style={styles.footnote}>Авторизация защищена Supabase. Пароль от Google не передаётся приложению.</p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "radial-gradient(ellipse at top, #1b1a10 0%, #090a0c 48%, #070809 100%)",
    color: "#f4f4f5",
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    width: "min(100%, 420px)",
    padding: "42px 34px",
    border: "1px solid #303136",
    borderRadius: 22,
    background: "#0b0c0eee",
    boxShadow: "0 25px 90px #0009",
    textAlign: "center",
  },
  mark: {
    display: "grid",
    placeItems: "center",
    width: 62,
    height: 62,
    margin: "0 auto 24px",
    borderRadius: 18,
    background: "#ffd400",
    color: "#101010",
    fontSize: 42,
    fontWeight: 900,
    fontStyle: "italic",
  },
  eyebrow: { color: "#ffd400", fontSize: 11, fontWeight: 800, letterSpacing: 3 },
  title: { margin: "12px 0", fontSize: "clamp(25px, 5vw, 34px)", letterSpacing: -1 },
  subtitle: { color: "#a6a7ae", fontSize: 14, lineHeight: 1.6 },
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
  error: { marginTop: 16, color: "#ff8585", fontSize: 12, overflowWrap: "anywhere" },
  footnote: { margin: "24px 0 0", color: "#777981", fontSize: 11, lineHeight: 1.6 },
};
