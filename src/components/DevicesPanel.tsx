import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { type SessionRecord, lastSeenLabel } from "../lib/sessions";
import { plural } from "../lib/storageUsage";
import { endAccountSession, loadAccountSessions, sessionTitle, type AccountSession, type SessionsResult } from "../lib/accountSessions";

type DevicesPanelProps = {
  /** What this browser remembers: shown in demo mode and when the server list is unavailable. */
  localDevices: SessionRecord[];
  currentDeviceId: string;
  onSignOutOthers: () => void;
  signingOut: boolean;
};

/**
 * Where this account is signed in, with a way to end any one of those sign-ins.
 *
 * The list is the server's (auth.sessions, through migration 20261054), so a phone signed in
 * last week shows up here even though this browser has never seen it. Without the migration
 * the panel falls back to what this browser remembers, and "Выйти на других" stays available,
 * because ending the other sessions does not need the list.
 */
export default function DevicesPanel({ localDevices, currentDeviceId, onSignOutOthers, signingOut }: DevicesPanelProps) {
  const cloud = Boolean(supabase);
  // null while the first answer is on its way.
  const [result, setResult] = useState<SessionsResult | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    const next = await loadAccountSessions(client);
    if (alive.current) setResult(next);
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  // After "Выйти на других" the list is asked for again rather than guessed.
  const wasSigningOut = useRef(signingOut);
  useEffect(() => {
    if (wasSigningOut.current && !signingOut) void reload();
    wasSigningOut.current = signingOut;
  }, [signingOut, reload]);

  async function end(session: AccountSession) {
    const client = supabase;
    if (!client) return;
    if (!window.confirm(`Завершить сеанс «${sessionTitle(session)}»? На том устройстве придётся войти заново.`)) return;
    setEndingId(session.id);
    setStatus("");
    const outcome = await endAccountSession(client, session.id);
    if (!alive.current) return;
    setEndingId(null);
    if (outcome === "ended" || outcome === "gone") {
      setResult((current) => (current?.status === "ok" ? { status: "ok", sessions: current.sessions.filter((item) => item.id !== session.id) } : current));
      setStatus(outcome === "ended" ? "Сеанс завершён. То устройство выйдет из аккаунта в течение часа." : "Этот сеанс уже был завершён.");
    } else {
      setStatus("Не удалось завершить сеанс. Попробуй ещё раз.");
    }
  }

  const now = Date.now();
  const serverList = result?.status === "ok" ? result.sessions : null;
  const others = serverList ? serverList.filter((session) => !session.current).length : 0;
  const count = serverList ? serverList.length : localDevices.length;
  const summary =
    cloud && result === null
      ? "Загружаю…"
      : cloud && !serverList
        ? result?.status === "missing"
          ? "Видно только это устройство"
          : "Не удалось загрузить список"
        : count <= 1
          ? "Только это устройство"
          : `${count} ${plural(count, "устройство", "устройства", "устройств")}`;
  // Without the server's list there is no telling whether other sessions exist, so the
  // button is offered; ending none of them is harmless.
  const offerSignOutOthers = cloud ? (serverList ? others > 0 : result !== null) : localDevices.length > 1;

  return (
    <>
      <div className="settings-row">
        <span>
          <strong>Устройства</strong>
          <small>{summary}</small>
        </span>
        {offerSignOutOthers && (
          <button type="button" className="settings-action danger" disabled={signingOut} onClick={onSignOutOthers}>
            {signingOut ? "Выхожу…" : "Выйти на других"}
          </button>
        )}
      </div>
      <ul className="device-list" aria-label="Устройства, где выполнен вход">
        {serverList
          ? serverList.map((session) => (
              <li key={session.id}>
                <span>
                  <strong>{sessionTitle(session)}</strong>
                  <small>{[session.current ? "Сейчас" : lastSeenLabel(session.lastActive, now), session.ip].filter(Boolean).join(" · ")}</small>
                </span>
                {session.current ? (
                  <b className="device-current">это устройство</b>
                ) : (
                  <button
                    type="button"
                    className="settings-action danger"
                    disabled={endingId !== null}
                    aria-label={`Завершить сеанс: ${sessionTitle(session)}`}
                    onClick={() => void end(session)}
                  >
                    {endingId === session.id ? "Завершаю…" : "Завершить"}
                  </button>
                )}
              </li>
            ))
          : localDevices.map((device) => (
              <li key={device.deviceId}>
                <span>
                  <strong>
                    {device.label} · {device.platform}
                  </strong>
                  <small>{lastSeenLabel(device.lastSeen, now)}</small>
                </span>
                {device.deviceId === currentDeviceId && <b className="device-current">это устройство</b>}
              </li>
            ))}
      </ul>
      {result?.status === "missing" && (
        <p className="settings-note">Чтобы здесь были все устройства, выполни в Supabase миграцию 20261054_account_sessions.sql.</p>
      )}
      {status && (
        <p className="settings-note" role="status">
          {status}
        </p>
      )}
    </>
  );
}
