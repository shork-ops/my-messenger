/**
 * Reporting a message or a conversation.
 *
 * The point of this module is not the database call - that is three lines - but the reasons a
 * report can go wrong:
 *
 * * A person reporting the same thing repeatedly should not create a pile. The server refuses
 *   duplicates; the interface should not make the pile in the first place, and the answer the
 *   person gets should not be an error.
 * * A report must go to the conversation it belongs to. Reporting a message in one chat while
 *   passing another chat's id is the kind of bug that makes moderation meaningless, so the
 *   pairing is checked before the request is made.
 * * The person has to know what will happen. "Жалоба отправлена" alone leaves them wondering
 *   whether anything is done with it.
 */

export const REPORT_REASONS = [
  { id: "spam", label: "Спам или реклама" },
  { id: "abuse", label: "Оскорбления или угрозы" },
  { id: "illegal", label: "Незаконный контент" },
  { id: "other", label: "Другое" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export type ReportTarget = {
  /** The conversation the report is about. Always required. */
  chatId: string;
  /** A single message, or `null` to report the whole conversation. */
  messageId: string | null;
};

const REASON_IDS = REPORT_REASONS.map((reason) => reason.id);

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REASON_IDS as string[]).includes(value);
}

/**
 * Whether the target can be reported at all.
 *
 * The identifiers have to be real ones from the server. A locally created chat or a message
 * that has not finished sending has nothing to attach a complaint to, and reporting it would
 * silently fail - so it is refused before the button is offered.
 */
export function isReportable(target: ReportTarget | null | undefined): boolean {
  if (!target) return false;
  if (!target.chatId) return false;
  // A message report needs a message; a chat report must not carry one, or the server would
  // have to guess which of the two was meant.
  if (target.messageId !== null && !target.messageId) return false;
  return true;
}

/** The text of the dialog, before anything is sent. */
export function reportPrompt(mode: "message" | "chat"): string {
  return mode === "message"
    ? "Что не так с этим сообщением?"
    : "Что не так с этим разговором?";
}

/**
 * The sentence shown after a report was accepted.
 *
 * It says what actually happens and what does not: no automatic deletion, and the other person
 * is not told. Promising "мы заблокируем" would be a promise this code cannot keep.
 */
export const REPORT_SENT =
  "Жалоба отправлена. Собеседник об этом не узнает; сообщение останется, пока её не рассмотрят.";

/** Shown when the same target was already reported - not an error, just a fact. */
export const REPORT_DUPLICATE = "Вы уже жаловались на это. Жалоба ждёт рассмотрения.";

/**
 * The text of a complaint, trimmed and bounded.
 *
 * The limit is the column's: sending more would make the insert fail with a database error the
 * person cannot act on, so it is cut here and the person is told - rather than silently losing
 * the end of what they wrote.
 */
export const REPORT_DETAILS_LIMIT = 1000;

export type DetailsResult = { text: string | null; truncated: boolean };

export function clampDetails(input: string): DetailsResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { text: null, truncated: false };
  if (trimmed.length <= REPORT_DETAILS_LIMIT) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, REPORT_DETAILS_LIMIT), truncated: true };
}

/** The reason a report failed, turned into something a person can act on. */
export function reportError(code: string | undefined): string {
  if (code === "not_a_member") return "Вы больше не участник этого разговора, пожаловаться нельзя";
  if (code === "message_not_found") return "Сообщение удалено — жаловаться уже не на что";
  if (code === "not_authenticated") return "Нужно войти в аккаунт";
  if (code === "no_subject") return "Отправлять некуда: разговор не выбран";
  return "Жалобу отправить не удалось. Попробуйте ещё раз";
}

/**
 * How the queue looks from one person's side: their own reports, grouped by state.
 *
 * Deliberately not a window onto other people's complaints - there is no such data here.
 */
export type ReportStatus = "open" | "reviewed" | "dismissed" | "actioned";

export function statusLabel(status: ReportStatus): string {
  if (status === "open") return "Ждёт рассмотрения";
  if (status === "reviewed") return "Просмотрена";
  if (status === "dismissed") return "Отклонена";
  return "Приняты меры";
}

/** Whether a person can report again: a resolved complaint does not bar a new one. */
export function canReportAgain(existing: { status: ReportStatus } | null | undefined): boolean {
  if (!existing) return true;
  // Waiting on a complaint and filing the same one again changes nothing.
  return existing.status !== "open";
}
