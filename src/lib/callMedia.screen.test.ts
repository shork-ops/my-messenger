import { describe, expect, it } from "vitest";
import { SCREEN_TRACK_NAME, isScreenTrack } from "./callMedia";

describe("isScreenTrack", () => {
  it("recognises the name the screen is published under", () => {
    expect(isScreenTrack(SCREEN_TRACK_NAME)).toBe(true);
    expect(SCREEN_TRACK_NAME).toBe("screen");
  });

  // A camera track keeps the default publication name, which is not "screen". Anything
  // that is not positively the screen must go to the camera element, so a mistake here
  // costs a wrong picture rather than a missing one.
  it("sends a camera track to the camera", () => {
    expect(isScreenTrack(undefined)).toBe(false);
    expect(isScreenTrack("")).toBe(false);
    expect(isScreenTrack("camera")).toBe(false);
    expect(isScreenTrack("video")).toBe(false);
  });

  it("does not match a name that merely contains the word", () => {
    expect(isScreenTrack("screencast")).toBe(false);
    expect(isScreenTrack("my-screen")).toBe(false);
    expect(isScreenTrack("SCREEN")).toBe(false);
  });
});
