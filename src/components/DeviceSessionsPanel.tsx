/**
 * The "where am I signed in" panel.
 *
 * It replaces a list the browser used to invent: that list only ever knew about devices that had
 * opened the app in this profile, kept them after sign-out, could not see a phone, and the button
 * beside it deleted local rows without ending anything on the server. Every row here comes from the
 * server, and every action goes through the `revoke-session` Edge Function, which is the only
 * component that can end a session in Supabase Auth.
 *
 * The panel keeps three different truths apart, because conflating them is how a settings screen ends
 * up lying:
 *
 * - a real list of sessions,
 * - "the server could not answer" — shown as such, never as "no other devices",
 * - "this is not deployed on this project yet" — also shown as such, since that is a fact about the
 *   build and not about the account.
 *
 * Only two actions exist, because only two exist in the API that actually revokes: end this device,
 * and end all the others. There is deliberately no per-row "Завершить" button: Supabase's admin API
 * in supabase-js 2.118 has no per-session revoke, so a per-row button would either do nothing or sign
 * out every device while claiming to end one.
 *
 * The footnote is not decoration. The previous version claimed the session was cut off at once; these
 * lines say what is true - the refresh token is refused, and an access token already handed out lives
 * until it expires.
 */

import { type DeviceSession, DEVICE_SESSIONS_LIMITS, type SessionError } from "../lib/deviceSessions";
import type { SessionListState } from "../hooks/useDeviceSessions";
import { plural } from "../lib/storageUsage";

/** "5 минут назад" from an ISO timestamp, without pulling in the whole formatter. */
export function sessionSeenLabel(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "давно";
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "день", "дня", "дней")} назад`;
}

const UNAVAILABLE_TEXT: Record<SessionError, string> = {
  offline: "Не удалось получить список с сервера. Проверьте подключение.",
  "not-deployed": "Список сессий недоступен на этом сервере: обновление ещё не развёрнуто.",
  refused: "Сервер отклонил запрос списка сессий.",
};

const ACTION_ERROR_TEXT: Record<SessionError, string> = {
  offline: "Не удалось связаться с сервером",
  "not-deployed": "Завершение сессий не развёрнуто на этом сервере",
  refused: "Сервер отклонил действие",
};

export type DeviceSessionsPanelProps = {
  state: SessionListState;
  busy: boolean;
  actionError: SessionError | null;
  onRevokeThis: () => Promise<unknown>;
  onRevokeOthers: () => Promise<unknown>;
  /** Shown after a successful revoke, e.g. "остальные сессии завершены". */
  notice: string | null;
};

export function DeviceSessionsPanel({
  state,
  busy,
  actionError,
  onRevokeThis,
  onRevokeOthers,
  notice,
}: DeviceSessionsPanelProps) {
  const others = state.kind === "ready" ? state.sessions.filter((session) => !session.isCurrent) : [];

  return (
    <div className="device-sessions">
      <div className="settings-row">
        <span>
          <strong>Активные сессии</strong>
          <small>
            {state.kind === "loading"
              ? "Загружаю…"
              : state.kind === "unavailable"
                ? "Список недоступен"
                : others.length === 0
                  ? "Только это устройство"
                  : `${others.length} ${plural(others.length, "другое устройство", "других устройства", "других устройств")}`}
          </small>
        </span>
        {state.kind === "ready" && others.length > 0 && (
          <button
            type="button"
            className="settings-action danger"
            disabled={busy}
            onClick={() => void onRevokeOthers()}
          >
            {busy ? "Завершаю…" : "Выйти на других"}
          </button>
        )}
      </div>

      {state.kind === "unavailable" && <p className="settings-note" role="status">{UNAVAILABLE_TEXT[state.error]}</p>}
      {actionError && <p className="settings-note is-error" role="alert">{ACTION_ERROR_TEXT[actionError]}</p>}
      {notice && <p className="settings-note" role="status">{notice}</p>}

      {state.kind === "ready" && (
        <ul className="device-list">
          {state.sessions.map((session) => (
            <SessionRow key={session.id} session={session} busy={busy} onRevokeThis={onRevokeThis} />
          ))}
        </ul>
      )}

      <ul className="settings-note device-limits">
        {DEVICE_SESSIONS_LIMITS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function SessionRow({
  session,
  busy,
  onRevokeThis,
}: {
  session: DeviceSession;
  busy: boolean;
  onRevokeThis: () => Promise<unknown>;
}) {
  return (
    <li>
      <span>
        <strong>
          {session.label} · {session.platform}
        </strong>
        <small>{session.isCurrent ? "активна сейчас" : `активна ${sessionSeenLabel(session.lastSeenAt)}`}</small>
      </span>
      {session.isCurrent ? (
        // Signing out of the device you are using is a different action, and the label stays plain
        // so nobody mistakes it for "end this one and stay signed in".
        <button type="button" className="settings-action danger" disabled={busy} onClick={() => void onRevokeThis()}>
          {busy ? "Завершаю…" : "Выйти здесь"}
        </button>
      ) : (
        // No per-row action on purpose: the API cannot revoke one other session. The bulk action
        // above is the honest counterpart. Saying why, instead of a dead button, is the point.
        <b className="device-current">завершить — «Выйти на других»</b>
      )}
    </li>
  );
}
