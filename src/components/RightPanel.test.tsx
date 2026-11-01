/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RightPanel, { chatKind, chatMedia } from "./RightPanel";
import type { Chat, Message } from "../types";

/**
 * The panel the header's "Профиль чата" opens. It used to show only the reader's own card,
 * whichever chat was open; it now shows the chat.
 */

vi.mock("../lib/supabase", () => ({ supabase: null }));

const image = (id: number, extra: Partial<NonNullable<Message["attachment"]>> = {}): Message => ({
  id,
  author: "Аня",
  text: "",
  time: "10:0" + id,
  attachment: { name: `photo-${id}.jpg`, type: "image/jpeg", data: `https://example.invalid/${id}.jpg`, size: 2048, thumbnail: `data:image/jpeg;base64,${id}`, ...extra },
});
const file = (id: number): Message => ({
  id,
  author: "Аня",
  text: "",
  time: "11:00",
  attachment: { name: `report-${id}.pdf`, type: "application/pdf", data: "", size: 3 * 1024 * 1024 },
});

const chat: Chat = {
  id: 5,
  name: "Аня",
  avatar: "А",
  color: "rose",
  preview: "",
  time: "",
  remoteId: "remote-5",
  messages: [image(1), file(2), image(3, { viewOnce: true }), image(4), { id: 6, author: "Аня", text: "привет", time: "12:00" }],
};

const baseProps = {
  profileName: "Алексей",
  profileAvatar: "А",
  chat,
  members: [],
  myRole: null,
  onClose: vi.fn(),
  onOpenProfile: vi.fn(),
  onCreateInvite: vi.fn(),
  onRotateInvite: vi.fn(),
  onChangeRole: vi.fn(),
  onRemoveMember: vi.fn(),
  onLeaveGroup: vi.fn(),
  onOpenGallery: vi.fn(),
  autoloadMedia: true,
};

describe("chat info panel", () => {
  it("names the kind of chat", () => {
    expect(chatKind(chat)).toBe("Личный облачный диалог");
    expect(chatKind({ ...chat, remoteId: undefined })).toBe("Локальный чат на этом устройстве");
    expect(chatKind({ ...chat, group: true, members: ["a", "b", "c"] })).toBe("Группа · участников: 3");
    expect(chatKind({ ...chat, channel: true, members: ["a"] })).toBe("Канал · подписчиков: 1");
  });

  it("collects pictures and files newest first, leaving view-once media out", () => {
    const { images, files } = chatMedia(chat);
    expect(images.map((m) => m.id)).toEqual([4, 1]);
    expect(files.map((m) => m.id)).toEqual([2]);
  });

  it("shows the open chat, its pictures and files, and the reader's own card below", () => {
    const onOpenGallery = vi.fn();
    render(<RightPanel {...baseProps} onOpenGallery={onOpenGallery} />);
    expect(screen.getAllByText("Аня")[0]).toBeTruthy();
    expect(screen.getByText("Личный облачный диалог")).toBeTruthy();
    expect(screen.getByText("report-2.pdf")).toBeTruthy();
    expect(screen.getByText(/3\.0 МБ/)).toBeTruthy();
    // A direct chat has nobody to invite.
    expect(screen.queryByText("Скопировать ссылку-приглашение")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Все фото" }));
    expect(onOpenGallery).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Мой профиль/ })).toBeTruthy();
  });

  it("draws only inline previews when pictures wait for a tap", () => {
    const { container } = render(
      <RightPanel {...baseProps} autoloadMedia={false} chat={{ ...chat, messages: [image(1, { thumbnail: undefined }), image(2)] }} />
    );
    const sources = [...container.querySelectorAll(".chat-info-media img")].map((img) => img.getAttribute("src"));
    expect(sources).toEqual(["data:image/jpeg;base64,2"]);
  });

  it("offers the invitation in a group", () => {
    render(<RightPanel {...baseProps} chat={{ ...chat, group: true }} />);
    expect(screen.getByText("Скопировать ссылку-приглашение")).toBeTruthy();
  });
});
