/**
 * Game invitations.
 *
 * The thing that was wrong before is worth stating: the card on the last message of the first
 * demo chat was decorative, and pressing it said an invitation would appear soon. These tests
 * cover the round trip - an invitation written into a message, parsed back out of it, and drawn
 * as a card that opens a real game.
 */

/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import {
  encodeInvitation,
  gameName,
  INVITE_PREFIX,
  invitationAction,
  invitationNote,
  invitationPreview,
  invitationText,
  isGameKind,
  parseInvitation,
} from "./invitation";
import GameInviteCard from "../../components/games/GameInviteCard";

describe("writing an invitation into a message", () => {
  it("round-trips through the text of the message", () => {
    const invitation = { kind: "chess" as const, from: "Аня", to: "Борис", gameId: "game-7" };
    const encoded = encodeInvitation(invitation);
    expect(encoded.startsWith(INVITE_PREFIX)).toBe(true);
    expect(parseInvitation(encoded)).toEqual(invitation);
  });

  it("survives without a game id", () => {
    const invitation = { kind: "balda" as const, from: "Аня", to: "Борис", gameId: null };
    expect(parseInvitation(encodeInvitation(invitation))).toEqual(invitation);
  });

  it("leaves ordinary messages alone", () => {
    expect(parseInvitation("Привет! Играем в шахматы?")).toBeNull();
    expect(parseInvitation("")).toBeNull();
  });

  it("does not believe a marker that is broken", () => {
    // Half-believing a broken string would draw a card pointing at a game that does not exist.
    expect(parseInvitation(`${INVITE_PREFIX}chess`)).toBeNull();
    expect(parseInvitation(`${INVITE_PREFIX}poker | от Аня | кому Борис`)).toBeNull();
    expect(parseInvitation(`${INVITE_PREFIX}chess | кому Борис`)).toBeNull();
  });

  it("recognises only the three games that exist", () => {
    expect(isGameKind("chess")).toBe(true);
    expect(isGameKind("cards")).toBe(true);
    expect(isGameKind("balda")).toBe(true);
    expect(isGameKind("checkers")).toBe(false);
  });
});

describe("what the card says", () => {
  const invitation = { kind: "cards" as const, from: "Аня", to: "Борис", gameId: null };

  it("speaks to the person who was invited", () => {
    expect(invitationText(invitation, true)).toContain("Аня приглашает вас");
    expect(invitationAction(invitation, true)).toContain("Играть");
  });

  it("speaks to the person who invited", () => {
    expect(invitationText(invitation, false)).toContain("Вы пригласили Борис");
    expect(invitationAction(invitation, false)).toContain("Открыть");
  });

  it("names the game, not a placeholder", () => {
    expect(gameName("cards")).toBe("Uno");
    expect(invitationText(invitation, true)).toContain("Uno");
  });

  it("says honestly that the game is local for now", () => {
    // A card that implies a shared board wastes the other player's time: they accept and find
    // their own separate game.
    expect(invitationNote()).toContain("на вашем устройстве");
    expect(invitationNote()).toContain("по сети");
  });

  it("gives the chat list a readable line", () => {
    expect(invitationPreview(encodeInvitation(invitation))).toBe("Uno: приглашение");
    expect(invitationPreview("просто текст")).toBeNull();
  });
});

describe("the card on screen", () => {
  const invitation = { kind: "chess" as const, from: "Аня", to: "Борис", gameId: null };

  it("shows the game and both sides", () => {
    const { container } = render(
      <GameInviteCard invitation={invitation} viewerIsInvited onOpen={() => undefined} />
    );
    expect(container.textContent).toContain("Шахматы");
    expect(container.textContent).toContain("Аня приглашает вас");
  });

  it("opens the game when it is pressed", () => {
    let opened = 0;
    const { container } = render(
      <GameInviteCard
        invitation={invitation}
        viewerIsInvited
        onOpen={() => {
          opened += 1;
        }}
      />
    );
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    fireEvent.click(button!);
    expect(opened).toBe(1);
  });

  it("shows the invitation as the invited person sees it from the other side", () => {
    const { container } = render(
      <GameInviteCard invitation={invitation} viewerIsInvited={false} onOpen={() => undefined} />
    );
    expect(container.textContent).toContain("Вы пригласили Борис");
  });
});
