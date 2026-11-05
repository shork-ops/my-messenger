import { useEffect, useState } from "react";

/** Browser connectivity is a hint, not an acknowledgement from the chat server. */
export default function ConnectionStatus({loadError,loading=false,onRetry}: {loadError?: string|null;loading?: boolean;onRetry?:()=>void} = {}) {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (online && loadError) return <div className="connection-status" role="alert">{loadError} <button type="button" onClick={onRetry}>Повторить загрузку</button></div>;
  if (online && loading) return <div className="connection-status" role="status">Загружаем переписку…</div>;
  if (online) return null;
  return <div className="connection-status" role="status" aria-live="polite">Нет сети. Черновики сохраняются; неотправленные сообщения можно повторить.</div>;
}
