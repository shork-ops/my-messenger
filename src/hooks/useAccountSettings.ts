/**
 * The account's own settings.
 *
 * Everything here is about the person using the app rather than about a conversation: what
 * others see, who is blocked, what is stored on this device, and the two irreversible actions -
 * signing every other device out, and deleting the account.
 *
 * The irreversible ones ask before acting and report what happened. A confirmation dialog that
 * is not backed by the server refusing a stale request is decoration, so each of these waits
 * for its answer before clearing anything locally.
 */

import type { Dispatch, SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { deleteAccount, savePrivacyPreferences, unblockUser, type PrivacyPreferences } from "../lib/privacy";
import { describeVisibility, type VisibilitySettings } from "../lib/visibility";
export function useAccountSettings(deps: {
  accountId: string | null;
  notify: (text: string) => void;
  setPrivacySaving: Dispatch<SetStateAction<boolean>>;
  setVisibilityState: Dispatch<SetStateAction<VisibilitySettings>>;
  setCacheKeys: Dispatch<SetStateAction<string[]>>;
  setDeletingAccount: Dispatch<SetStateAction<boolean>>;
  setClearingCache: Dispatch<SetStateAction<boolean>>;
  setBlockedEntries: Dispatch<SetStateAction<string[]>>;
  privacy: PrivacyPreferences;
  setPrivacy: Dispatch<SetStateAction<PrivacyPreferences>>;
  visibility: VisibilitySettings;
  cacheKeys: string[];
}) {
  async function changePrivacy(next: PrivacyPreferences) {
    const client = supabase;
    const previous = deps.privacy;
    deps.setPrivacy(next);
    if (!client || !deps.accountId) return;
    deps.setPrivacySaving(true);
    const result = await savePrivacyPreferences(client, deps.accountId, next);
    deps.setPrivacySaving(false);
    if (!result.ok) {
      deps.setPrivacy(previous);
      deps.notify("Не удалось сохранить настройку приватности");
    }
  }

  async function changeVisibility(next: VisibilitySettings) {
    const previous = deps.visibility;
    deps.setVisibilityState(next);
    const client = supabase;
    if (!client || !deps.accountId) {
      deps.notify("Настройка сохранена");
      return;
    }
    const { error } = await client
      .from("profiles")
      .update({ profile_visibility: next.profile, message_policy: next.messages })
      .eq("id", deps.accountId);
    if (error) {
      // Put it back rather than showing a switch that saved nothing.
      deps.setVisibilityState(previous);
      deps.notify("Не удалось сохранить настройку видимости");
      return;
    }
    deps.notify(describeVisibility(next));
  }

  async function clearCache() {
    deps.setClearingCache(true);
    try {
      for (const key of deps.cacheKeys) window.localStorage.removeItem(key);
      // The service-worker cache is separate from local storage and is the part
      // that actually grows.
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      deps.setCacheKeys([]);
      deps.notify("Кеш очищен");
    } catch {
      deps.notify("Не удалось очистить кеш");
    } finally {
      deps.setClearingCache(false);
    }
  }


  async function confirmDeleteAccount() {
    const client = supabase;
    if (!client) return;
    if (!window.confirm("Удалить аккаунт навсегда? Это действие нельзя отменить.")) return;
    deps.setDeletingAccount(true);
    const result = await deleteAccount(client);
    deps.setDeletingAccount(false);
    if (!result.ok) {
      deps.notify(result.message);
      return;
    }
    deps.notify("Аккаунт удалён");
  }

  async function unblockPerson(userId: string) {
    const client = supabase;
    if (!client) return;
    const result = await unblockUser(client, userId);
    if (!result.ok) {
      deps.notify(result.message);
      return;
    }
    deps.setBlockedEntries((current) => current.filter((entry) => !entry.startsWith(`${userId}:`)));
    deps.notify("Пользователь разблокирован");
  }

  return {
    changePrivacy,
    changeVisibility,
    clearCache,
    confirmDeleteAccount,
    unblockPerson,
  };
}
