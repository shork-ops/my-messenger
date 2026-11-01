import { describe, expect, it } from "vitest";
import {
  EMAIL_CODE_MAX_LENGTH,
  formatCountdown,
  isCodeComplete,
  isValidEmail,
  normalizeCode,
  normalizeEmail,
  signInErrorMessage,
} from "./signIn";

describe("normalizeEmail", () => {
  it("drops spaces around a pasted address and ignores case", () => {
    expect(normalizeEmail("  Anna.Petrova@Mail.RU \n")).toBe("anna.petrova@mail.ru");
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary and unusual but valid addresses", () => {
    expect(isValidEmail("anna@mail.ru")).toBe(true);
    expect(isValidEmail("first.last+nexus@sub.example.co.uk")).toBe(true);
  });

  it("catches the typos people actually make", () => {
    expect(isValidEmail("anna.mail.ru")).toBe(false);
    expect(isValidEmail("anna@mail")).toBe(false);
    expect(isValidEmail("anna @mail.ru")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("refuses an address longer than email allows", () => {
    expect(isValidEmail(`${"a".repeat(250)}@x.ru`)).toBe(false);
  });
});

describe("normalizeCode", () => {
  it("keeps digits only, so a code pasted with spaces or dashes works", () => {
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
  });

  it("never grows past the longest code Supabase can send", () => {
    expect(normalizeCode("1234567890123")).toHaveLength(EMAIL_CODE_MAX_LENGTH);
  });

  it("respects a shorter limit for authenticator codes", () => {
    expect(normalizeCode("12345678", 6)).toBe("123456");
  });
});

describe("isCodeComplete", () => {
  it("accepts 6 to 10 digits, the range the project setting allows", () => {
    expect(isCodeComplete("123456")).toBe(true);
    expect(isCodeComplete("1234567890")).toBe(true);
  });

  it("waits for the whole code", () => {
    expect(isCodeComplete("12345")).toBe(false);
    expect(isCodeComplete("")).toBe(false);
  });

  it("refuses anything that is not digits", () => {
    expect(isCodeComplete("12345a")).toBe(false);
  });
});

describe("formatCountdown", () => {
  it("reads as minutes and seconds", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(45)).toBe("0:45");
    expect(formatCountdown(5)).toBe("0:05");
  });

  it("never shows a negative time", () => {
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("signInErrorMessage", () => {
  it("explains a rate limit as waiting, not as a failure", () => {
    expect(signInErrorMessage({ code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" })).toContain("Подожди");
    expect(signInErrorMessage({ status: 429, message: "" })).toContain("Подожди");
  });

  it("tells that a wrong or old code can be requested again", () => {
    expect(signInErrorMessage({ code: "otp_expired", message: "Token has expired or is invalid" })).toContain("запроси новый");
    expect(signInErrorMessage({ message: "Token has expired or is invalid" })).toContain("запроси новый");
  });

  it("points to the address when Supabase rejects it", () => {
    expect(signInErrorMessage({ code: "email_address_invalid", message: 'Email address "a@b.c" is invalid' })).toContain("адрес почты");
  });

  it("sends people to Google when email sign-in is switched off", () => {
    expect(signInErrorMessage({ code: "email_provider_disabled" })).toContain("Google");
    expect(signInErrorMessage({ code: "otp_disabled" })).toContain("Google");
    expect(signInErrorMessage({ code: "signup_disabled", message: "Signups not allowed for otp" })).toContain("Google");
  });

  it("does not blame the person when the letter could not be sent", () => {
    expect(signInErrorMessage({ code: "email_address_not_authorized" })).toContain("Не удалось отправить письмо");
    expect(signInErrorMessage({ code: "unexpected_failure", message: "Error sending magic link email" })).toContain("Не удалось отправить письмо");
  });

  it("names a wrong authenticator code", () => {
    expect(signInErrorMessage({ code: "mfa_verification_failed", message: "Invalid TOTP code entered" })).toContain("Неверный код");
  });

  it("recognises a lost connection", () => {
    expect(signInErrorMessage({ message: "Failed to fetch" })).toContain("интернет");
  });

  it("never shows Supabase's raw English text", () => {
    const text = signInErrorMessage({ code: "something_new", message: "Database error saving new user" });
    expect(text).toBe("Не получилось войти. Попробуй ещё раз.");
  });
});
