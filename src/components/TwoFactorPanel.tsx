import { useState } from "react";
import { QrCode, ShieldCheck } from "lucide-react";
import {
  TOTP_CODE_LENGTH,
  describeTotpUri,
  factorSummary,
  formatSecret,
  isValidTotpCode,
} from "../lib/twoFactor";

type TwoFactorPanelProps = {
  /** The factor already enrolled, if any. */
  status: "verified" | "unverified" | null;
  /** Present while the user is in the middle of enrolling. */
  pending: { uri: string; secret: string } | null;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onSubmitCode: (code: string) => void;
  onCancel: () => void;
  onDisable: () => void;
};

/**
 * Two-factor setup.
 *
 * The secret is shown as text as well as offered as a QR: a camera that will not
 * focus on a laptop screen is the most common reason setup fails, and a person
 * typing the code by hand is not doing anything wrong.
 */
export default function TwoFactorPanel({
  status,
  pending,
  busy,
  error,
  onStart,
  onSubmitCode,
  onCancel,
  onDisable,
}: TwoFactorPanelProps) {
  const [code, setCode] = useState("");
  const details = pending ? describeTotpUri(pending.uri) : null;

  if (pending) {
    return (
      <div className="twofactor">
        <p className="settings-note">
          Открой приложение-аутентификатор (Google Authenticator, 1Password, Aegis) и добавь аккаунт по ключу ниже.
        </p>
        <div className="twofactor-secret">
          <QrCode size={18} />
          <code>{formatSecret(pending.secret)}</code>
        </div>
        {details && (
          <p className="settings-note">
            {details.issuer ? `${details.issuer} · ` : ""}
            {details.account}
          </p>
        )}
        <label className="twofactor-code">
          Код из приложения
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={TOTP_CODE_LENGTH}
            value={code}
            aria-label="Код из приложения"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH))}
          />
        </label>
        {error && <span className="twofactor-error">{error}</span>}
        <div className="twofactor-actions">
          <button type="button" className="settings-action" disabled={busy || !isValidTotpCode(code)} onClick={() => onSubmitCode(code)}>
            {busy ? "Проверяю…" : "Подтвердить"}
          </button>
          <button type="button" className="settings-action" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="twofactor">
      <p className="settings-note">{factorSummary(status)}</p>
      {status === "verified" ? (
        <button type="button" className="settings-action danger" disabled={busy} onClick={onDisable}>
          {busy ? "Отключаю…" : "Отключить 2FA"}
        </button>
      ) : (
        <button type="button" className="settings-action" disabled={busy} onClick={onStart}>
          <ShieldCheck size={16} /> {busy ? "Готовлю…" : "Подключить 2FA"}
        </button>
      )}
      {error && <span className="twofactor-error">{error}</span>}
    </div>
  );
}
