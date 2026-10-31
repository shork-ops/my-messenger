/**
 * The complaint dialog.
 *
 * The server part is a tested function; what needed testing here is the path a person walks:
 * the button stays disabled until a reason is chosen, the request carries the reason and the
 * bounded text, and the answer says what actually happens - including when the complaint was a
 * duplicate, which is not a failure.
 */

/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

const submitReport = vi.fn();
vi.mock("../lib/reportSubmit", () => ({
  submitReport: (...args: unknown[]) => submitReport(...args),
}));

const { default: ReportModal } = await import("./ReportModal");

const messageTarget = { chatId: "chat-1", messageId: "msg-1" };

beforeEach(() => {
  submitReport.mockReset();
  submitReport.mockResolvedValue({ ok: true, duplicate: false });
});

function typeReason(container: HTMLElement, id: string) {
  const input = container.querySelector(`input[value="${id}"]`);
  expect(input).not.toBeNull();
  fireEvent.click(input!);
}

describe("the complaint dialog", () => {
  it("cannot be sent before a reason is chosen", () => {
    const { container } = render(<ReportModal target={messageTarget} onClose={() => undefined} />);
    const send = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Отправить"))!;
    expect(send.disabled).toBe(true);
  });

  it("asks about the message, not the conversation", () => {
    const { container } = render(<ReportModal target={messageTarget} onClose={() => undefined} />);
    expect(container.textContent).toContain("Что не так с этим сообщением?");
  });

  it("asks about the conversation when no message is given", () => {
    const { container } = render(<ReportModal target={{ chatId: "chat-1", messageId: null }} onClose={() => undefined} />);
    expect(container.textContent).toContain("Что не так с этим разговором?");
  });

  it("sends the chosen reason and the text", async () => {
    const { container } = render(<ReportModal target={messageTarget} onClose={() => undefined} />);
    typeReason(container, "abuse");
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "  угрозы  " } });

    const send = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Отправить"))!;
    fireEvent.click(send);

    await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(1));
    expect(submitReport).toHaveBeenCalledWith(messageTarget, "abuse", "  угрозы  ");
  });

  it("says the complaint was sent without promising removal", async () => {
    const { container } = render(<ReportModal target={messageTarget} onClose={() => undefined} />);
    typeReason(container, "spam");
    const send = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Отправить"))!;
    fireEvent.click(send);

    await waitFor(() => expect(container.textContent).toContain("Жалоба отправлена"));
    // The text must not promise deletion: nothing is deleted automatically.
    expect(container.textContent).not.toContain("удалим");
    expect(container.textContent).toContain("не узнает");
  });

  it("tells a duplicate apart from a first complaint", async () => {
    // Pressing twice is not an error, but it is also not a new complaint.
    submitReport.mockResolvedValue({ ok: true, duplicate: true });
    const { container } = render(<ReportModal target={messageTarget} onClose={() => undefined} />);
    typeReason(container, "spam");
    const send = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Отправить"))!;
    fireEvent.click(send);

    await waitFor(() => expect(container.textContent).toContain("уже жаловались"));
  });

  it("shows the server's refusal in words a person can act on", async () => {
    submitReport.mockResolvedValue({ ok: false, message: "Вы больше не участник этого разговора, пожаловаться нельзя" });
    const { container } = render(<ReportModal target={messageTarget} onClose={() => undefined} />);
    typeReason(container, "spam");
    const send = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Отправить"))!;
    fireEvent.click(send);

    await waitFor(() => expect(container.textContent).toContain("больше не участник"));
    // The dialog stays open so the person can retry rather than losing what they wrote.
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("warns before losing the end of a long text", () => {
    const { container } = render(<ReportModal target={messageTarget} onClose={() => undefined} />);
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "а".repeat(1100) } });
    expect(container.textContent).toContain("будет сокращён");
  });

  it("offers every reason the server accepts", () => {
    const { container } = render(<ReportModal target={messageTarget} onClose={() => undefined} />);
    const values = Array.from(container.querySelectorAll("input")).map((input) => input.value);
    expect(values).toEqual(["spam", "abuse", "illegal", "other"]);
  });
});
