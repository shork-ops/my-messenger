import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCREEN_QUALITY,
  canShareScreen,
  describeSurface,
  shareEnded,
  shareErrorMessage,
  screenShareRequest,
} from "./screenShare";

describe("screenShareRequest", () => {
  it("defaults to text, which is what a shared document needs", () => {
    expect(DEFAULT_SCREEN_QUALITY).toBe("text");
    expect(screenShareRequest().video.frameRate.ideal).toBe(5);
  });

  it("asks for 1080p for text", () => {
    expect(screenShareRequest("text").video.width.ideal).toBe(1920);
  });

  it("asks for a higher frame rate for motion", () => {
    expect(screenShareRequest("motion").video.frameRate.ideal).toBe(30);
  });

  it("leaves the frame rate room to exceed the ideal a little", () => {
    const request = screenShareRequest("text");
    expect(request.video.frameRate.max).toBeGreaterThan(request.video.frameRate.ideal);
  });

  it("does not ask for system audio, which is silent on several platforms", () => {
    expect(screenShareRequest("motion").audio).toBe(false);
  });

  it("prefers the whole screen over a single window", () => {
    expect(screenShareRequest().video.displaySurface).toBe("monitor");
  });
});

describe("canShareScreen", () => {
  it("is true when the browser has getDisplayMedia", () => {
    expect(canShareScreen({ mediaDevices: { getDisplayMedia: () => {} } })).toBe(true);
  });

  it("is false on a browser without it", () => {
    expect(canShareScreen({ mediaDevices: {} })).toBe(false);
  });

  it("is false with no media devices at all, as on an insecure page", () => {
    expect(canShareScreen({})).toBe(false);
  });
});

describe("describeSurface", () => {
  it("names each surface a person can pick", () => {
    expect(describeSurface("monitor")).toBe("Весь экран");
    expect(describeSurface("window")).toBe("Окно");
    expect(describeSurface("browser")).toBe("Вкладка");
  });

  it("falls back to a neutral word", () => {
    expect(describeSurface(undefined)).toBe("Экран");
    expect(describeSurface("something-new")).toBe("Экран");
  });
});

describe("shareErrorMessage", () => {
  it("explains a refused permission", () => {
    expect(shareErrorMessage("NotAllowedError")).toBe("Доступ к экрану не выдан");
  });

  it("distinguishes a cancelled picker from a refused one", () => {
    expect(shareErrorMessage("AbortError")).toBe("Выбор экрана отменён");
  });

  it("says when the browser cannot do it at all", () => {
    expect(shareErrorMessage("NotSupportedError")).toContain("не умеет");
    expect(shareErrorMessage("TypeError")).toContain("не умеет");
  });

  it("has a fallback that is not the raw error name", () => {
    expect(shareErrorMessage("WhateverError")).toBe("Не удалось начать показ экрана");
  });
});

describe("shareEnded", () => {
  it("notices the browser stopping a share", () => {
    expect(shareEnded({ readyState: "ended" })).toBe(true);
  });

  it("is false while the share is live", () => {
    expect(shareEnded({ readyState: "live" })).toBe(false);
  });
});
