/**
 * The receiving side of a call has to attach audio, not just video.
 *
 * This exists because the bug it guards was invisible to every test that came before: the
 * room connected, both people appeared in the participant list, the microphone indicator was
 * on, the video element showed the other person - and neither side heard anything. The audio
 * track was subscribed and then dropped by an early return that only handled video.
 *
 * No room is connected here. What is checked is the element the audio is played through, and
 * the naming rule that decides which element a video track belongs in.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isScreenTrack, SCREEN_TRACK_NAME, remoteAudioTargetForTests, resetRemoteAudioForTests } from "./callMedia";

describe("telling incoming tracks apart", () => {
  it("recognises a screen track by the publisher name", () => {
    expect(isScreenTrack(SCREEN_TRACK_NAME)).toBe(true);
  });

  it("does not mistake a camera track or a lookalike name for a screen", () => {
    // A camera publication may carry no name at all; treating that as "screen" would put the
    // peer in the screen element and leave the camera element empty.
    expect(isScreenTrack(undefined)).toBe(false);
    expect(isScreenTrack("camera")).toBe(false);
    expect(isScreenTrack("screen-share")).toBe(false);
    expect(isScreenTrack("SCREEN")).toBe(false);
    expect(isScreenTrack("")).toBe(false);
  });
});

describe("the element remote audio is played through", () => {
  let appended: unknown[] = [];

  beforeEach(() => {
    appended = [];
    // The element is a module singleton: each test starts with none, or the second test
    // would see the first one and prove nothing about creation.
    resetRemoteAudioForTests();
    vi.stubGlobal("document", {
      createElement: (tag: string) => ({
        tag,
        autoplay: false,
        muted: true,
        style: {},
        setAttribute: vi.fn(),
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
        srcObject: "something",
      }),
      body: {
        appendChild: (node: unknown) => {
          appended.push(node);
          return node;
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is an audio element that is not muted and plays by itself", () => {
    // Muting it would reproduce the bug differently: the element would exist and stay
    // silent, which is harder to notice than no element at all.
    const element = remoteAudioTargetForTests();
    expect(element).not.toBeNull();
    expect(element?.autoplay).toBe(true);
    expect(element?.muted).toBe(false);
  });

  it("is in the document, because an element outside it is not played everywhere", () => {
    const element = remoteAudioTargetForTests();
    expect(appended).toContain(element);
  });
});
