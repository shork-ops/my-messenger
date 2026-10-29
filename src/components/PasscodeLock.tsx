import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { PASSCODE_LENGTH, isValidPasscode, passcodeMatches } from "../lib/sessions";

type PasscodeLockProps = {
  /** The stored code; the lock is shown only when one exists. */
  passcode: string;
  onUnlock: () => void;
};

/**
 * The screen shown when the app is locked.
 *
 * Deliberately plain: no previews, no names, no message counts. A lock screen that
 * leaks the last message defeats the point of the lock.
 */
export default function PasscodeLock({ passcode, onUnlock }: PasscodeLockProps) {
  const [entered, setEntered] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(value: string) {
    if (passcodeMatches(passcode, value)) {
      onUnlock();
      return;
    }
    // Clear the field as well as flagging it: leaving four wrong digits in place
    // invites a second attempt on stale input.
    setError(true);
    setEntered("");
  }

  return (
    <div className="passcode-layer" role="dialog" aria-modal="true" aria-label="Приложение заблокировано">
      <div className="passcode-card">
        <span className="passcode-icon" aria-hidden="true">
          <Lock size={22} />
        </span>
        <strong>Приложение заблокировано</strong>
        <p>Введи код из {PASSCODE_LENGTH} цифр, чтобы продолжить.</p>
        <input
          ref={inputRef}
          className={`passcode-input${error ? " error" : ""}`}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PASSCODE_LENGTH}
          value={entered}
          aria-label="Код доступа"
          aria-invalid={error}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, PASSCODE_LENGTH);
            setEntered(digits);
            setError(false);
            // Submit on the last digit: a separate button adds a step for nothing.
            if (isValidPasscode(digits)) submit(digits);
          }}
        />
        {error && <span className="passcode-error">Неверный код</span>}
      </div>
    </div>
  );
}
