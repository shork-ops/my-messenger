import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type FactorStatus = "verified" | "unverified" | null;

/**
 * TOTP two-factor through Supabase.
 *
 * Enrolling returns a secret that must be confirmed with a code from the
 * authenticator before the factor counts: an unverified factor protects nothing,
 * and deleting it must work from any state or a failed setup would be permanent.
 */
export function useTwoFactor(client: SupabaseClient | null, accountId: string | null) {
  const [status, setStatus] = useState<FactorStatus>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ uri: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !accountId) return;
    const { data } = await client.auth.mfa.listFactors();
    const totp = (data?.all ?? []).filter((factor) => factor.factor_type === "totp");
    const verified = totp.find((factor) => factor.status === "verified");
    const unverified = totp.find((factor) => factor.status === "unverified");
    if (verified) {
      setStatus("verified");
      setFactorId(verified.id);
    } else if (unverified) {
      setStatus("unverified");
      setFactorId(unverified.id);
    } else {
      setStatus(null);
      setFactorId(null);
    }
  }, [client, accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      // An abandoned enrolment would otherwise block a second attempt.
      if (factorId && status === "unverified") await client.auth.mfa.unenroll({ factorId });
      const { data, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Nexus" });
      if (enrollError || !data) {
        setError("Не удалось начать подключение. Попробуй ещё раз.");
        return;
      }
      setFactorId(data.id);
      setPending({ uri: data.totp.uri, secret: data.totp.secret });
      setStatus("unverified");
    } finally {
      setBusy(false);
    }
  }, [client, factorId, status]);

  const confirm = useCallback(
    async (code: string) => {
      if (!client || !factorId) return;
      setBusy(true);
      setError(null);
      try {
        const challenge = await client.auth.mfa.challenge({ factorId });
        if (challenge.error) {
          setError("Код не принят. Попробуй новый код.");
          return;
        }
        const verify = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
        if (verify.error) {
          // Wrong or expired: the common case is a code from the previous period.
          setError("Неверный код. Введи следующий код из приложения.");
          return;
        }
        setPending(null);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [client, factorId, refresh]
  );

  const cancel = useCallback(async () => {
    if (!client || !factorId) return;
    setBusy(true);
    try {
      await client.auth.mfa.unenroll({ factorId });
      setPending(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [client, factorId, refresh]);

  const disable = useCallback(async () => {
    if (!client || !factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: unenrollError } = await client.auth.mfa.unenroll({ factorId });
      if (unenrollError) {
        setError("Не удалось отключить 2FA");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [client, factorId, refresh]);

  return { status, pending, busy, error, start, confirm, cancel, disable };
}
