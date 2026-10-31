export const MAX_MESSAGE_LENGTH = 10_000;
export const MESSAGE_TOO_LONG = "Сообщение длиннее 10 000 символов. Разделите его на несколько сообщений.";
// PostgreSQL char_length counts Unicode code points, not UTF-16 code units.
export function exceedsMessageLimit(text: string): boolean { return Array.from(text).length > MAX_MESSAGE_LENGTH; }
