import { describe, expect, it } from "vitest";
import {
  FREE_PLAN_MAX_PARTICIPANTS,
  FREE_PLAN_MINUTES,
  freePlanNote,
  minutesWarning,
  participantLimitNotice,
  shouldWarnBeforeCall,
} from "./callPlan";

/**
 * The point of these tests is the silence the module exists to break: nothing here may quietly
 * return null when the plan is about to refuse someone.
 */
describe("the free plan, said before the call rather than during it", () => {
  it("says nothing for a call that cannot reach the cap", () => {
    expect(participantLimitNotice(2)).toBeNull();
    expect(participantLimitNotice(FREE_PLAN_MAX_PARTICIPANTS - 1)).toBeNull();
    expect(shouldWarnBeforeCall(3)).toBe(false);
  });

  it("warns at the cap, and says what happens to the next person", () => {
    const notice = participantLimitNotice(FREE_PLAN_MAX_PARTICIPANTS);
    expect(notice).toContain(String(FREE_PLAN_MAX_PARTICIPANTS));
    expect(notice).toContain("Следующий не сможет подключиться");
    expect(shouldWarnBeforeCall(FREE_PLAN_MAX_PARTICIPANTS)).toBe(true);
  });

  it("keeps warning past the cap", () => {
    expect(participantLimitNotice(FREE_PLAN_MAX_PARTICIPANTS + 5)).not.toBeNull();
  });

  it("stays quiet on a paid plan, where the cap is not the plan's", () => {
    expect(participantLimitNotice(FREE_PLAN_MAX_PARTICIPANTS + 5, "paid")).toBeNull();
    expect(freePlanNote("paid")).toBeNull();
    expect(shouldWarnBeforeCall(FREE_PLAN_MAX_PARTICIPANTS, "paid")).toBe(false);
  });

  it("mentions both numbers so nobody is surprised by the second one", () => {
    const note = freePlanNote();
    expect(note).toContain(String(FREE_PLAN_MAX_PARTICIPANTS));
    expect(note).toContain(FREE_PLAN_MINUTES.toLocaleString("ru-RU"));
    expect(note).toContain("минут");
  });
});

describe("running out of minutes", () => {
  it("says nothing while there is plenty left", () => {
    expect(minutesWarning(3000)).toBeNull();
    expect(minutesWarning(null)).toBeNull();
  });

  it("warns while the person can still choose the phone", () => {
    expect(minutesWarning(90)).toContain("90");
    expect(minutesWarning(120)).not.toBeNull();
  });

  it("says plainly that calls will not connect once they are gone", () => {
    expect(minutesWarning(0)).toContain("не подключатся");
    expect(minutesWarning(-10)).toContain("не подключатся");
  });
});
