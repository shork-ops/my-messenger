/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOAuth: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  mfa: { challengeAndVerify: vi.fn() },
}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabase: { auth, rpc }, isSupabaseConfigured: true }));
vi.mock("./constants", () => ({ isDemoMode: false }));
import AuthGate from "./AuthGate";

type Listener = (event: string, session: unknown) => void;
let listener: Listener = () => undefined;

function tokenWith(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function sessionWith(aal: "aal1" | "aal2", factors: Array<{ id: string; factor_type: string; status: string }> = []) {
  return { access_token: tokenWith({ aal, sub: "user-1" }), user: { id: "user-1", factors } };
}

const verifiedTotp = { id: "factor-1", factor_type: "totp", status: "verified" };

function renderGate() {
  return render(
    <AuthGate>
      <div>Private chat</div>
    </AuthGate>
  );
}

async function requestCode(address = " Anna@Mail.ru ") {
  fireEvent.change(await screen.findByLabelText("Почта"), { target: { value: address } });
  fireEvent.click(screen.getByRole("button", { name: "Получить код" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({data:null,error:null});
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.onAuthStateChange.mockImplementation((callback: Listener) => {
    listener = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => cleanup());

describe("email sign-in", () => {
  it("keeps Google and offers email next to it", async () => {
    renderGate();
    expect(await screen.findByRole("button", { name: "Продолжить с Google" })).toBeTruthy();
    expect(screen.getByLabelText("Почта")).toBeTruthy();
    expect(screen.queryByText("Private chat")).toBeNull();
  });

  it("sends a code to the cleaned-up address and asks for it", async () => {
    renderGate();
    await requestCode();
    expect(await screen.findByText("Проверь почту")).toBeTruthy();
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "anna@mail.ru",
      options: { shouldCreateUser: true, emailRedirectTo: expect.any(String) },
    });
    expect(screen.getByText("anna@mail.ru")).toBeTruthy();
    const resend = screen.getByRole("button", { name: /Отправить ещё раз через 1:00/ }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
  });

  it("does not call Supabase for an address with a typo", async () => {
    renderGate();
    await requestCode("anna.mail.ru");
    expect((await screen.findByRole("alert")).textContent).toContain("адрес почты");
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("explains in Russian when the letter cannot be sent", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" } });
    renderGate();
    await requestCode();
    expect((await screen.findByRole("alert")).textContent).toContain("Подожди минуту");
    expect(screen.queryByText("Проверь почту")).toBeNull();
  });

  it("verifies the code and opens the app once the session arrives", async () => {
    renderGate();
    await requestCode();
    fireEvent.change(await screen.findByLabelText("Код из письма"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "anna@mail.ru", token: "123456", type: "email" }));
    act(() => listener("SIGNED_IN", sessionWith("aal1")));
    expect(await screen.findByText("Private chat")).toBeTruthy();
  });

  it("says so when the code is wrong or old", async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: { code: "otp_expired", message: "Token has expired or is invalid" } });
    renderGate();
    await requestCode();
    fireEvent.change(await screen.findByLabelText("Код из письма"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect((await screen.findByRole("alert")).textContent).toContain("запроси новый код");
    expect(screen.queryByText("Private chat")).toBeNull();
  });

  it("lets the address be changed after a code was sent", async () => {
    renderGate();
    await requestCode();
    fireEvent.click(await screen.findByRole("button", { name: "Изменить почту" }));
    expect(((await screen.findByLabelText("Почта")) as HTMLInputElement).value).toBe("anna@mail.ru");
  });
});

describe("second factor at sign-in", () => {
  it("asks for the authenticator code before any chat is shown", async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessionWith("aal1", [verifiedTotp]) }, error: null });
    renderGate();
    expect(await screen.findByText("Ещё один шаг")).toBeTruthy();
    expect(screen.queryByText("Private chat")).toBeNull();

    fireEvent.change(screen.getByLabelText("Код из приложения"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    await waitFor(() => expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "654321" }));

    act(() => listener("MFA_CHALLENGE_VERIFIED", sessionWith("aal2", [verifiedTotp])));
    expect(await screen.findByText("Private chat")).toBeTruthy();
  });

  it("keeps the app closed after a wrong authenticator code", async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessionWith("aal1", [verifiedTotp]) }, error: null });
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { code: "mfa_verification_failed", message: "Invalid TOTP code entered" } });
    renderGate();
    fireEvent.change(await screen.findByLabelText("Код из приложения"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Неверный код");
    expect(screen.queryByText("Private chat")).toBeNull();
  });

  it("opens straight away for a session that already passed the second step", async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessionWith("aal2", [verifiedTotp]) }, error: null });
    renderGate();
    expect(await screen.findByText("Private chat")).toBeTruthy();
  });

  it("offers a way out to another account", async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessionWith("aal1", [verifiedTotp]) }, error: null });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "Выйти и войти в другой аккаунт" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" }));
  });
});
