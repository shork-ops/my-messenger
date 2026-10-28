import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Group management RPCs. All authorization lives in Postgres
 * (`20261034_group_management.sql`): the client only decides what to show.
 *
 * Every call returns a discriminated result instead of throwing, so the UI can
 * tell a permission problem ("not an admin") from a network or backend failure
 * without parsing error strings.
 */
export type GroupActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; message: string };

const DENIED = "Недостаточно прав для этого действия";

function describe(error: { message: string } | null): GroupActionResult<never> {
  const message = error?.message ?? "Не удалось выполнить действие";
  // PostgREST surfaces the plpgsql exception text and SQLSTATE 42501.
  if (/42501|permission|Only admins|Only the owner|cannot/i.test(message)) {
    return { ok: false, message: /owner/i.test(message) ? "Это может сделать только владелец группы" : DENIED };
  }
  if (/invalid or expired/i.test(message)) return { ok: false, message: "Ссылка-приглашение недействительна или истекла" };
  if (/not a member/i.test(message)) return { ok: false, message: "Пользователь не состоит в группе" };
  if (/Transfer ownership/i.test(message)) return { ok: false, message: "Сначала передай владение или удали группу" };
  return { ok: false, message };
}

export type ChatMember = { user_id: string; role: string; joined_at: string; display_name?: string | null };

/** Members of a group with display names, ordered owner → admin → member. */
export async function fetchChatMembers(client: SupabaseClient, chatId: string): Promise<GroupActionResult<ChatMember[]>> {
  const { data, error } = await client
    .from("chat_members")
    .select("user_id, role, joined_at")
    .eq("chat_id", chatId);
  if (error) return describe(error);

  const members = (data ?? []) as ChatMember[];
  if (members.length === 0) return { ok: true, data: [] };

  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("id, display_name")
    .in("id", members.map((member) => member.user_id));
  if (profileError) return describe(profileError);

  const names = new Map((profiles ?? []).map((profile) => [profile.id as string, profile.display_name as string | null]));
  const weight: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  return {
    ok: true,
    data: members
      .map((member) => ({ ...member, display_name: names.get(member.user_id) ?? null }))
      .sort((a, b) => (weight[a.role] ?? 3) - (weight[b.role] ?? 3) || a.joined_at.localeCompare(b.joined_at)),
  };
}

/** Promotes or demotes a member. Owner-only, enforced by the RPC. */
export async function setMemberRole(
  client: SupabaseClient,
  chatId: string,
  userId: string,
  role: "owner" | "admin" | "member"
): Promise<GroupActionResult<string>> {
  const { data, error } = await client.rpc("set_chat_member_role", {
    target_chat_id: chatId,
    target_user_id: userId,
    new_role: role,
  });
  if (error) return describe(error);
  return { ok: true, data: data as string };
}

/** Removes a member, or leaves the group when the target is the current user. */
export async function removeMember(
  client: SupabaseClient,
  chatId: string,
  userId: string
): Promise<GroupActionResult<string>> {
  const { data, error } = await client.rpc("remove_chat_member", {
    target_chat_id: chatId,
    target_user_id: userId,
  });
  if (error) return describe(error);
  return { ok: true, data: data as string };
}

/** Issues a fresh invite code, optionally with a lifetime in hours. */
export async function rotateInvite(
  client: SupabaseClient,
  chatId: string,
  lifetimeHours: number | null = null
): Promise<GroupActionResult<string>> {
  const { data, error } = await client.rpc("rotate_chat_invite", {
    target_chat_id: chatId,
    lifetime_hours: lifetimeHours,
  });
  if (error) return describe(error);
  return { ok: true, data: data as string };
}

/** Which management buttons the current user may use, given their own role. */
export function canManageGroup(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

export function canChangeRoles(role: string | null): boolean {
  return role === "owner";
}
