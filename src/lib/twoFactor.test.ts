import { describe, expect, it } from "vitest";
import {
  TOTP_CODE_LENGTH,
  describeTotpUri,
  factorSummary,
  formatSecret,
  isValidTotpCode,
  needsSecondFactor,
  accessLevel,
  secondFactorFor,
} from "./twoFactor";

describe("isValidTotpCode", () => {
  it("accepts exactly six digits", () => {
    expect(isValidTotpCode("123456")).toBe(true);
    expect(isValidTotpCode("000000")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidTotpCode("12345")).toBe(false);
    expect(isValidTotpCode("1234567")).toBe(false);
    expect(isValidTotpCode("12345a")).toBe(false);
    expect(isValidTotpCode("")).toBe(false);
    expect(isValidTotpCode("12 34 56")).toBe(false);
  });

  it("has a length constant that matches the rule", () => {
    expect(TOTP_CODE_LENGTH).toBe(6);
  });
});

describe("describeTotpUri", () => {
  const uri =
    "otpauth://totp/Nexus:shork%40example.com?issuer=Nexus&secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30";

  it("reads the issuer, the account and the secret", () => {
    expect(describeTotpUri(uri)).toEqual({
      issuer: "Nexus",
      account: "shork@example.com",
      secret: "JBSWY3DPEHPK3PXP",
    });
  });

  it("falls back to the issuer in the path when the query has none", () => {
    expect(describeTotpUri("otpauth://totp/Nexus:a%40b.c?secret=ABCD")).toEqual({
      issuer: "Nexus",
      account: "a@b.c",
      secret: "ABCD",
    });
  });

  it("handles an account with no issuer prefix", () => {
    expect(describeTotpUri("otpauth://totp/justaname?secret=XY")).toEqual({
      issuer: "",
      account: "justaname",
      secret: "XY",
    });
  });

  it("returns null for something that is not a TOTP URI", () => {
    expect(describeTotpUri("https://example.com")).toBeNull();
    expect(describeTotpUri("")).toBeNull();
  });
});

describe("formatSecret", () => {
  it("groups by four so it can be read off a screen", () => {
    expect(formatSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("uppercases and drops whitespace", () => {
    expect(formatSecret("abcd efgh")).toBe("ABCD EFGH");
  });

  it("leaves a short secret alone", () => {
    expect(formatSecret("ABC")).toBe("ABC");
    expect(formatSecret("ABCD")).toBe("ABCD");
  });

  it("does not leave a trailing space", () => {
    expect(formatSecret("ABCDEFGH")).toBe("ABCD EFGH");
  });
});

describe("factorSummary", () => {
  it("describes each state", () => {
    expect(factorSummary("verified")).toContain("Включена");
    expect(factorSummary("unverified")).toContain("Незавершённое");
    expect(factorSummary(null)).toContain("Выключена");
  });
});

describe("needsSecondFactor", () => {
  it("is required once a verified factor exists and the session is only aal1", () => {
    expect(needsSecondFactor(1, "aal1")).toBe(true);
  });

  it("is satisfied after the second step", () => {
    expect(needsSecondFactor(1, "aal2")).toBe(false);
  });

  it("is never required without a factor, because that would lock everyone out", () => {
    expect(needsSecondFactor(0, "aal1")).toBe(false);
    expect(needsSecondFactor(0, null)).toBe(false);
  });

  it("is required when the level is unknown but a factor exists", () => {
    expect(needsSecondFactor(2, null)).toBe(true);
  });
});

/** A token with the given payload; the signature part is irrelevant to the client check. */
function tokenWith(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("accessLevel", () => {
  it("reads the level the server wrote into the token", () => {
    expect(accessLevel(tokenWith({ aal: "aal1" }))).toBe("aal1");
    expect(accessLevel(tokenWith({ aal: "aal2", sub: "u" }))).toBe("aal2");
  });

  it("treats a missing or unreadable token as no level", () => {
    expect(accessLevel(null)).toBeNull();
    expect(accessLevel("not-a-token")).toBeNull();
    expect(accessLevel("a.%%%.c")).toBeNull();
    expect(accessLevel(tokenWith({ aal: "aal9" }))).toBeNull();
  });
});

describe("secondFactorFor", () => {
  const verified = { id: "factor-1", factor_type: "totp", status: "verified" };

  it("asks for the authenticator after a plain sign-in when a factor is verified", () => {
    expect(secondFactorFor({ access_token: tokenWith({ aal: "aal1" }), user: { factors: [verified] } })).toBe("factor-1");
  });

  it("lets the session through once the code was entered", () => {
    expect(secondFactorFor({ access_token: tokenWith({ aal: "aal2" }), user: { factors: [verified] } })).toBeNull();
  });

  it("ignores a setup that was never finished, or nobody could sign in after abandoning it", () => {
    const unverified = { id: "factor-2", factor_type: "totp", status: "unverified" };
    expect(secondFactorFor({ access_token: tokenWith({ aal: "aal1" }), user: { factors: [unverified] } })).toBeNull();
  });

  it("does nothing for accounts without two-factor", () => {
    expect(secondFactorFor({ access_token: tokenWith({ aal: "aal1" }), user: { factors: [] } })).toBeNull();
    expect(secondFactorFor({ access_token: tokenWith({ aal: "aal1" }), user: {} })).toBeNull();
    expect(secondFactorFor(null)).toBeNull();
  });

  it("keeps the step when the token cannot be read", () => {
    expect(secondFactorFor({ access_token: "broken", user: { factors: [verified] } })).toBe("factor-1");
  });
});
