/**
 * Who may see this profile, and who may write to it.
 *
 * The rules are stated as a small set of named choices rather than as a list of
 * checkboxes, because "можно ли мне писать" is a question people answer as a
 * whole: either everyone, or only people I already know.
 */

export const PROFILE_VISIBILITY = [
  { id: "everyone", label: "Все пользователи", hint: "Профиль виден в поиске всем" },
  { id: "known", label: "Только знакомые", hint: "Профиль виден в поиске тем, с кем есть чат" },
  { id: "nobody", label: "Никто", hint: "Меня нельзя найти поиском" },
] as const;

export const MESSAGE_POLICY = [
  { id: "everyone", label: "Все пользователи", hint: "Любой может начать чат" },
  { id: "known", label: "Только знакомые", hint: "Новые люди пишут только через общий чат" },
] as const;

export type ProfileVisibility = (typeof PROFILE_VISIBILITY)[number]["id"];
export type MessagePolicy = (typeof MESSAGE_POLICY)[number]["id"];

export type VisibilitySettings = {
  profile: ProfileVisibility;
  messages: MessagePolicy;
};

export const DEFAULT_VISIBILITY: VisibilitySettings = {
  profile: "everyone",
  messages: "everyone",
};

/**
 * Whether a stranger may find this profile in search.
 *
 * "Known" means the two share a chat. Being visible to a stranger and being
 * writable by one are separate questions with separate settings, so this one is
 * answered only for finding.
 */
export function isSearchable(visibility: ProfileVisibility): boolean {
  return visibility !== "nobody";
}

/** Whether a stranger may open a direct chat. */
export function acceptsStrangers(policy: MessagePolicy): boolean {
  return policy === "everyone";
}

/**
 * Whether this person may start a chat with us.
 *
 * Both the profile visibility and the message policy must allow it: hiding from
 * search while still accepting messages from anyone would be incoherent.
 */
export function mayStartChat(settings: VisibilitySettings, known: boolean): boolean {
  if (known) return true;
  if (!isSearchable(settings.profile)) return false;
  return acceptsStrangers(settings.messages);
}

/**
 * Reads whatever was stored, filling in defaults.
 *
 * An unrecognised value becomes the default rather than throwing: a preference
 * lost in an update should not lock a person out of their own profile.
 */
export function parseVisibility(raw: unknown): VisibilitySettings {
  const record = (raw ?? {}) as Partial<Record<keyof VisibilitySettings, unknown>>;
  const profile = PROFILE_VISIBILITY.some((item) => item.id === record.profile)
    ? (record.profile as ProfileVisibility)
    : DEFAULT_VISIBILITY.profile;
  const messages = MESSAGE_POLICY.some((item) => item.id === record.messages)
    ? (record.messages as MessagePolicy)
    : DEFAULT_VISIBILITY.messages;
  return { profile, messages };
}

/** The one-line summary shown under the section title. */
export function describeVisibility(settings: VisibilitySettings): string {
  if (!isSearchable(settings.profile)) return "Меня нельзя найти поиском";
  if (acceptsStrangers(settings.messages)) return "Профиль виден всем, писать может любой";
  return "Профиль виден знакомым, писать могут только знакомые";
}
