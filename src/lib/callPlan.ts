/**
 * The free LiveKit plan, said out loud.
 *
 * Group calls run on LiveKit, and the owner confirmed the project is on the free plan. Free is
 * not unlimited: there are minutes per month and a cap on people in one room at the same time.
 *
 * The failure this file exists to prevent is the silent one. When the cap is reached, LiveKit
 * refuses the connection, and without a warning the person sees "соединение потеряно" in the
 * middle of a conversation and concludes the messenger is broken. Saying it before the call
 * starts turns a mystery into a fact: it is the plan, not the app, and the rest of the call
 * still works.
 *
 * The numbers below are the published free-plan limits. They are configuration, not constants of
 * nature: LiveKit has changed them before, so they are in one place with a comment saying where
 * to look them up.
 */

/** Anyone in a room beyond this is refused while the project is on the free plan. */
export const FREE_PLAN_MAX_PARTICIPANTS = 20;

/** Monthly minutes included in the free plan. */
export const FREE_PLAN_MINUTES = 5000;

export type CallPlan = "free" | "paid";

/**
 * "В звонке уже 20 человек" — the warning shown before the call starts, or null when there is
 * nothing to warn about.
 *
 * Written as a plain consequence rather than a policy: what happens to the next person to join.
 */
export function participantLimitNotice(joining: number, plan: CallPlan = "free"): string | null {
  if (plan === "paid") return null;
  if (joining < FREE_PLAN_MAX_PARTICIPANTS) return null;
  return `В звонке уже ${joining} человек — это предел бесплатного тарифа. Следующий не сможет подключиться, и звонок для него оборвётся.`;
}

/**
 * The note shown once, on the call surface, for every group call on the free plan.
 *
 * Shown for a group call because that is the shape of call the limit affects; a call between
 * two people never reaches twenty.
 */
export function freePlanNote(plan: CallPlan = "free"): string | null {
  if (plan === "paid") return null;
  return `Бесплатный тариф LiveKit: до ${FREE_PLAN_MAX_PARTICIPANTS} человек в звонке и ${FREE_PLAN_MINUTES.toLocaleString("ru-RU")} минут в месяц. Когда минуты закончатся, звонки перестанут подключаться до следующего месяца.`;
}

/**
 * How many minutes are left, as a warning, or null when there is nothing worth saying.
 *
 * Reported rather than enforced: the app cannot stop the plan from running out, so the honest
 * thing is to tell the person while they can still choose to use the phone instead.
 */
export function minutesWarning(remaining: number | null, plan: CallPlan = "free"): string | null {
  if (plan === "paid" || remaining === null) return null;
  if (remaining <= 0) return "Минуты бесплатного тарифа закончились: звонки не подключатся до следующего месяца";
  if (remaining <= 120) return `Осталось ${remaining} минут бесплатного тарифа — меньше двух часов звонков`;
  return null;
}

/**
 * Whether a call is worth warning about *before* it starts, given how many people are in it.
 *
 * A separate predicate from the notice because the caller needs a decision, and the notice is
 * wording: changing the sentence should not change when the warning appears.
 */
export function shouldWarnBeforeCall(joining: number, plan: CallPlan = "free"): boolean {
  return plan === "free" && joining >= FREE_PLAN_MAX_PARTICIPANTS;
}
