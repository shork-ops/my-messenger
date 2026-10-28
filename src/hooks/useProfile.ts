import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type UseProfileOptions = { notify: (message: string) => void };

export function useProfile({ notify }: UseProfileOptions) {
  const [profileName, setProfileName] = useState(() => window.localStorage.getItem("nexus-profile-name") || "Алексей");
  const [profileAvatar, setProfileAvatar] = useState(() => window.localStorage.getItem("nexus-profile-avatar") || "N");
  const [username, setUsername] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [profileReady, setProfileReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setProfileReady(true);
      return;
    }
    let alive = true;
    const syncProfile = async () => {
      const client = supabase;
      if (!client) {
        setProfileReady(true);
        return;
      }
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (!alive) return;
      if (userError || !user) {
        setAccountId(null);
        setProfileReady(true);
        return;
      }
      setAccountId(user.id);
      const metadataName =
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : typeof user.user_metadata?.name === "string"
            ? user.user_metadata.name
            : "";
      const { data: existingProfile, error: readError } = await client
        .from("profiles")
        .select("display_name, avatar, username")
        .eq("id", user.id)
        .maybeSingle();
      if (!alive) return;
      if (readError) {
        setAccountId(null);
        notify("Не удалось загрузить профиль из Supabase");
        setProfileReady(true);
        return;
      }
      if (existingProfile) {
        setProfileName(existingProfile.display_name || metadataName || "Пользователь");
        setProfileAvatar(existingProfile.avatar || metadataName.slice(0, 1).toUpperCase() || "N");
        setUsername(existingProfile.username || "");
      } else {
        const displayName = metadataName.trim() || user.email?.split("@")[0] || "Пользователь";
        const avatar = displayName.slice(0, 1).toUpperCase() || "N";
        const { error: insertError } = await client.from("profiles").insert({ id: user.id, display_name: displayName, avatar });
        if (!alive) return;
        if (insertError) notify("Не удалось создать профиль в Supabase");
        else {
          setProfileName(displayName);
          setProfileAvatar(avatar);
        }
      }
      setProfileReady(true);
    };
    void syncProfile();
    return () => {
      alive = false;
    };
  }, [notify]);

  useEffect(() => {
    window.localStorage.setItem("nexus-profile-name", profileName);
    window.localStorage.setItem("nexus-profile-avatar", profileAvatar);
    const client = supabase;
    if (!client || !accountId || !profileReady) return;
    const saveProfile = async () => {
      const { error } = await client.from("profiles").upsert({
        id: accountId,
        display_name: profileName.trim() || "Пользователь",
        avatar: profileAvatar.trim() || "N",
        updated_at: new Date().toISOString(),
      });
      if (error) notify("Не удалось сохранить профиль в Supabase");
    };
    void saveProfile();
  }, [profileName, profileAvatar, accountId, profileReady, notify]);

  async function saveUsername() {
    const client = supabase;
    const normalized = username.trim().toLowerCase();
    if (!client || !accountId) {
      notify("Вход через Google необходим для сохранения username");
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      notify("Username: 3–20 символов, только латиница, цифры и _");
      return;
    }
    setUsernameSaving(true);
    const { error } = await client.from("profiles").update({ username: normalized }).eq("id", accountId);
    setUsernameSaving(false);
    if (error) {
      if (error.code === "23505") notify("Этот username уже занят. Выбери другой.");
      else if (error.code === "42703" || error.message.toLowerCase().includes("username")) notify("Сначала выполни SQL-миграцию username в Supabase");
      else notify("Не удалось сохранить username");
      return;
    }
    setUsername(normalized);
    notify("Username сохранён — по нему тебя можно будет найти");
  }

  return {
    profileName,
    setProfileName,
    profileAvatar,
    setProfileAvatar,
    username,
    setUsername,
    usernameSaving,
    accountId,
    profileReady,
    saveUsername,
  };
}
