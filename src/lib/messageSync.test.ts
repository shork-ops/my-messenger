import { describe, expect, it } from "vitest";
import { toAttachment } from "./messageSync";

/**
 * These tests exist because the mapper silently dropped `thumbnail`, `duration`
 * and `waveform`: the sender saw a perfect voice message and a compressed
 * photo, while the receiver got a flat waveform and no preview.
 */
describe("toAttachment", () => {
  it("never exposes a single-view thumbnail or ordinary signed URL", () => {
    const attachment = toAttachment({ path:"chat/user/photo.jpg",type:"image/jpeg",viewOnce:true,bucket:"view-once-media",thumbnail:"inline-secret" },"ordinary-signed-url");
    expect(attachment.viewOnce).toBe(true);
    expect(attachment.bucket).toBe("view-once-media");
    expect(attachment.data).toBe("");
    expect(attachment.thumbnail).toBeUndefined();
  });
  it("carries every voice-message field through the round trip", () => {
    const attachment = toAttachment(
      {
        name: "voice-1.webm",
        type: "audio/webm",
        size: 20_000,
        path: "chat/user/voice-1.webm",
        duration: 7,
        waveform: [0, 128, 255],
      },
      "https://signed",
      1_700_000_000_000
    );

    expect(attachment).toEqual({
      name: "voice-1.webm",
      type: "audio/webm",
      size: 20_000,
      path: "chat/user/voice-1.webm",
      data: "https://signed",
      expiresAt: 1_700_000_000_000,
      duration: 7,
      waveform: [0, 128, 255],
    });
  });

  it("carries the image preview and dimensions", () => {
    const attachment = toAttachment(
      {
        name: "photo.jpg",
        type: "image/jpeg",
        size: 100_000,
        path: "chat/user/photo.jpg",
        thumbnail: "data:image/png;base64,AAA",
        width: 1920,
        height: 1080,
      },
      "https://signed"
    );

    expect(attachment.thumbnail).toBe("data:image/png;base64,AAA");
    expect(attachment.width).toBe(1920);
    expect(attachment.height).toBe(1080);
  });

  it("fills sensible defaults for a sparse row", () => {
    expect(toAttachment({}, "")).toEqual({
      name: "Вложение",
      type: "application/octet-stream",
      size: 0,
      data: "",
    });
  });

  it("omits optional keys instead of storing undefined", () => {
    const attachment = toAttachment({ name: "a.txt", type: "text/plain", size: 1 }, "data:x");
    expect(Object.keys(attachment).sort()).toEqual(["data", "name", "size", "type"]);
  });

  it("keeps a zero second duration rather than dropping it", () => {
    const attachment = toAttachment({ name: "v.webm", duration: 0 }, "u");
    expect(attachment.duration).toBe(0);
  });
});
