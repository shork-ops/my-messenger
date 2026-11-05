import { Suspense, lazy, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";
import { isDemoMode } from "./constants";
import { secondFactorFor } from "./twoFactor";
import { authBaseStyles as styles } from "./authStyles";

// The forms are only needed by someone who is not signed in yet, so they load on demand.
const AccountAccessBoundary = lazy(() => import("./AccountAccessBoundary").then(module => ({ default: module.AccountAccessBoundary })));
const SignInScreen = lazy(() => import("./SignInScreens").then((module) => ({ default: module.SignInScreen })));
const SecondFactorScreen = lazy(() => import("./SignInScreens").then((module) => ({ default: module.SecondFactorScreen })));

type AuthGateProps = { children: ReactNode };

export default function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
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
      // The forms translate Supabase errors; this one only says that the check itself failed.
      if (sessionError) setError("Не удалось проверить вход. Попробуй ещё раз.");
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

  // Demo mode runs entirely on local data, so there is nothing to authenticate.
  if (isDemoMode) return <>{children}</>;
  if (!isSupabaseConfigured || !supabase) {
    if (!import.meta.env.PROD) return <>{children}</>;
    return <main style={styles.page}><section style={styles.card} role="alert"><div style={styles.mark}>N</div><h1 style={styles.title}>Сервис временно недоступен</h1><p style={styles.subtitle}>Не удалось настроить подключение. Попробуйте зайти позже.</p></section></main>;
  }
  if (loading) return <Checking />;
  if (session) {
    // Two-factor is enforced here, before any chat is rendered: a session that has not passed
    // the authenticator step yet only gets the code screen.
    const factorId = secondFactorFor(session);
    if (factorId) {
      return (
        <Suspense fallback={<Checking />}>
          <SecondFactorScreen factorId={factorId} />
        </Suspense>
      );
    }
    return <Suspense fallback={<Checking />}><AccountAccessBoundary userId={session.user.id} token={session.access_token}>{children}</AccountAccessBoundary></Suspense>;
  }
  return (
    <Suspense fallback={<Checking />}>
      <SignInScreen initialError={error} />
    </Suspense>
  );
}

function Checking() {
  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.mark}>N</div>
        <p style={styles.subtitle}>Проверяем авторизацию…</p>
      </div>
    </main>
  );
}
