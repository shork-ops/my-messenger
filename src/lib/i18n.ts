/**
 * Two languages, one dictionary.
 *
 * The app is Russian-first: every string already exists in Russian, so Russian is
 * the default and the source of truth for key names. English is a translation of
 * it, not a replacement - and a missing English string falls back to Russian
 * rather than to a key name, because a user reading Russian is confused, while a
 * user reading `settings.data.clear` is looking at a bug.
 */

export const LANGUAGES = [
  { id: "ru", label: "Русский" },
  { id: "en", label: "English" },
] as const;

export type Language = (typeof LANGUAGES)[number]["id"];

export const DEFAULT_LANGUAGE: Language = "ru";

/** Keys are flat and dot-separated; a nested tree buys nothing but indirection. */
export type Dictionary = Record<string, string>;

const en: Dictionary = {
  "nav.chats": "Chats",
  "nav.games": "Mini games",
  "nav.calls": "Calls",
  "nav.contacts": "Contacts",
  "nav.settings": "Settings",
  "nav.notifications": "Notifications",
  "nav.enableNotifications": "Enable notifications",
  "nav.checkNotifications": "Check notifications",

  "chat.search": "Search",
  "chat.newChat": "New chat",
  "chat.menu": "Chat menu",
  "chat.pin": "Pin chat",
  "chat.unpin": "Unpin chat",
  "chat.mute": "Mute",
  "chat.unmute": "Unmute",
  "chat.archive": "Archive",
  "chat.unarchive": "Unarchive",
  "chat.profile": "Chat profile",
  "chat.clearHistory": "Clear history",

  "filter.all": "All",
  "filter.unread": "Unread",
  "filter.pinned": "Pinned",
  "filter.groups": "Groups",
  "filter.archive": "Archive",

  "composer.placeholder": "Message",
  "composer.send": "Send",
  "composer.attach": "Attach a file",

  "settings.title": "Settings",
  "settings.back": "Back to sections",
  "settings.profile": "Profile",
  "settings.appearance": "Appearance",
  "settings.privacy": "Privacy",
  "settings.notifications": "Notifications",
  "settings.data": "Data",
  "settings.theme": "Theme",
  "settings.theme.dark": "Dark",
  "settings.theme.light": "Light",
  "settings.theme.gray": "Grey",
  "settings.textSize": "Text size",
  "settings.language": "Language",

  "settings.notify.system": "System notifications",
  "settings.notify.sound": "Sound",
  "settings.notify.vibration": "Vibration",
  "settings.notify.quiet": "Quiet hours",
  "settings.notify.quietHint": "No sound and no vibration. The notification still arrives.",

  "settings.data.attachments": "Attachments",
  "settings.data.cache": "Browser cache",
  "settings.data.clear": "Clear",
  "settings.data.empty": "Empty",
  "settings.data.noAttachments": "No attachments yet",

  "mute.1h": "For an hour",
  "mute.8h": "For 8 hours",
  "mute.1w": "For a week",
  "mute.forever": "Forever",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.back": "Back",
};

const DICTIONARIES: Record<Language, Dictionary> = { ru: {}, en };

/**
 * Looks up a string, falling back to Russian and then to the key.
 *
 * The chain matters: a missing English string must not turn the interface into
 * identifiers.
 */
export function translate(language: Language, key: string, ru: Dictionary = {}): string {
  const fromChosen = DICTIONARIES[language]?.[key];
  if (fromChosen) return fromChosen;
  const fromRussian = ru[key];
  if (fromRussian) return fromRussian;
  return key;
}

/** Where a given language is chosen from, for a select control. */
export function languageLabel(language: Language): string {
  return LANGUAGES.find((item) => item.id === language)?.label ?? language;
}

export const LANGUAGE_STORAGE_KEY = "nexus-language";

/** Anything unrecognised falls back to the default rather than breaking the UI. */
export function parseLanguage(raw: string | null | undefined): Language {
  if (raw === "en" || raw === "ru") return raw;
  return DEFAULT_LANGUAGE;
}
