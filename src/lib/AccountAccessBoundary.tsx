import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { authBaseStyles as styles } from "./authStyles";

/** UI follows the server decision; authorization itself is enforced in SQL/RLS. */
export function AccountAccessBoundary({ userId, token, children }: { userId: string; token: string; children: ReactNode }) {
  const [result, setResult] = useState<{ userId: string; status: "allowed" | "denied" | "unavailable" } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let alive = true, checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const { error } = await client!.rpc("assert_account_access");
        if (!alive) return;
        if (!error) setResult({userId,status:"allowed"});
        else if (error.code === "42501") setResult({userId,status:"denied"});
        else setResult(previous => previous?.userId === userId && previous.status === "allowed" ? previous : {userId,status:"unavailable"});
      } catch {
        if (alive) setResult(previous => previous?.userId === userId && previous.status === "allowed" ? previous : {userId,status:"unavailable"});
      } finally { checking = false; }
    }
    void check();
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    const timer = window.setInterval(visible,60_000);
    document.addEventListener("visibilitychange",visible);
    window.addEventListener("online",visible);
    return () => {alive=false;window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);window.removeEventListener("online",visible);};
  },[userId,token,retry]);
  const status = result?.userId === userId ? result.status : null;
  if (status === "allowed") return <>{children}</>;
  return <main style={styles.page}><section style={styles.card} role={status ? "alert" : "status"}>
    <h1 style={styles.title}>{status === "denied" ? "Подтвердите вход" : status === "unavailable" ? "Не удалось проверить доступ" : "Проверяем доступ…"}</h1>
    {status && <>
      <p style={styles.subtitle}>{status === "denied" ? "Сеанс завершён или требуется повторная проверка безопасности. Войдите в аккаунт снова." : "Проверьте подключение и повторите попытку."}</p>
      <button type="button" onClick={() => setRetry(value=>value+1)}>Повторить</button>
      <button type="button" onClick={() => void supabase?.auth.signOut({scope:"local"})}>Выйти</button>
    </>}
  </section></main>;
}
