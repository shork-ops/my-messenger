/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrivacyModal from "./PrivacyModal";
import { DEFAULT_PRIVACY } from "../lib/privacy";
import { DEFAULT_VISIBILITY } from "../lib/visibility";

/**
 * The privacy window.
 *
 * The one thing worth a test here is the honesty of the encryption note. The product decision
 * was to leave end-to-end encryption for a later day, and a deferred promise that reads as a
 * kept one is worse than either: it invites people to trust the app with something it cannot
 * protect yet.
 */

const baseProps = {
  open: true,
  preferences: DEFAULT_PRIVACY,
  blockedNames: [],
  saving: false,
  deleting: false,
  onChange: vi.fn(),
  visibility: DEFAULT_VISIBILITY,
  onVisibilityChange: vi.fn(),
  onUnblock: vi.fn(),
  onDeleteAccount: vi.fn(),
  onExportAll: vi.fn(),
  onClose: vi.fn(),
};

describe("PrivacyModal", () => {
  it("says there is no end-to-end encryption, in words a person can act on", () => {
    const { container } = render(<PrivacyModal {...baseProps} />);
    const note = container.querySelector(".encryption-note");
    expect(note).not.toBeNull();
    const text = note?.textContent ?? "";
    // The claim must be present and must not be softened into something reassuring but vague.
    expect(text).toContain("Сквозного шифрования пока нет");
    expect(text).toContain("ключ есть у сервера");
    // And it must not promise the opposite anywhere in the same box.
    expect(text).not.toMatch(/сквозное шифрование включено/i);
  });

  it("says what is still true, so the note is not only a warning", () => {
    const { container } = render(<PrivacyModal {...baseProps} />);
    const text = container.querySelector(".encryption-note")?.textContent ?? "";
    expect(text).toContain("Посторонний человек прочитать её не сможет");
  });

  it("keeps the switches working next to the note", () => {
    const onChange = vi.fn();
    const { container } = render(<PrivacyModal {...baseProps} onChange={onChange} />);
    // Scoped to this render: the DOM is not cleaned between tests in this project.
    const toggle = container.querySelector<HTMLInputElement>(".privacy-row input");
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLInputElement);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_PRIVACY, hideLastSeen: true });
  });

  it("offers the archive next to the deletion, not in a corner", () => {
    const onExportAll = vi.fn();
    const { container } = render(<PrivacyModal {...baseProps} onExportAll={onExportAll} />);
    const button = container.querySelector(".archive-button");
    expect(button?.textContent).toContain("Скачать архив");
    fireEvent.click(button as HTMLElement);
    expect(onExportAll).toHaveBeenCalledTimes(1);
    // Anyone about to delete an account should be able to find out what it holds first.
    expect(container.textContent).toContain("Вложения в архив не входят");
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PrivacyModal {...baseProps} open={false} />);
    expect(container.querySelector(".privacy-modal")).toBeNull();
  });
});
