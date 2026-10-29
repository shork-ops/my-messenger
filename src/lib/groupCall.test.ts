import { describe, expect, it } from "vitest";
import {
  inviteCandidates,
  isGroupCall,
  participantInitial,
  participantLabel,
  pluralParticipants,
  type RoomParticipant,
} from "./groupCall";

const person = (identity: string, name: string, muted = false): RoomParticipant => ({ identity, name, muted });

describe("isGroupCall", () => {
  it("is not a group call with nobody", () => {
    expect(isGroupCall([])).toBe(false);
  });

  it("is not a group call with the caller and one peer", () => {
    expect(isGroupCall([person("a", "Аня"), person("b", "Борис")])).toBe(false);
  });

  it("becomes a group call once a third person joins", () => {
    expect(isGroupCall([person("a", "Аня"), person("b", "Борис"), person("c", "Вера")])).toBe(true);
  });
});

describe("participantInitial", () => {
  it("uppercases the first letter", () => {
    expect(participantInitial("аня")).toBe("А");
  });

  it("uses the first code point, so an emoji survives", () => {
    expect(participantInitial("🐱 кот")).toBe("🐱");
  });

  it("falls back for a blank name", () => {
    expect(participantInitial("")).toBe("?");
    expect(participantInitial("   ")).toBe("?");
  });
});

describe("participantLabel", () => {
  it("prefers the name", () => {
    expect(participantLabel(person("u-1", "Аня"))).toBe("Аня");
  });

  it("falls back to a shortened identity when the name is empty", () => {
    expect(participantLabel(person("abcdef123456", "  "))).toBe("abcdef12");
  });

  it("trims a padded name", () => {
    expect(participantLabel(person("u-1", "  Аня  "))).toBe("Аня");
  });
});

describe("inviteCandidates", () => {
  const members = [
    { userId: "self", name: "Я" },
    { userId: "u-1", name: "Аня" },
    { userId: "u-2", name: "Борис" },
  ];

  it("lists members who are not on the call", () => {
    const found = inviteCandidates(members, [person("self", "Я"), person("u-1", "Аня")], "self");
    expect(found.map((member) => member.userId)).toEqual(["u-2"]);
  });

  it("never invites the caller", () => {
    const found = inviteCandidates(members, [], "self");
    expect(found.map((member) => member.userId)).not.toContain("self");
  });

  it("returns nothing when everyone is already there", () => {
    const found = inviteCandidates(
      members,
      [person("self", "Я"), person("u-1", "Аня"), person("u-2", "Борис")],
      "self"
    );
    expect(found).toEqual([]);
  });
});

describe("pluralParticipants", () => {
  it("inflects Russian correctly", () => {
    expect(pluralParticipants(1)).toBe("1 участник");
    expect(pluralParticipants(2)).toBe("2 участника");
    expect(pluralParticipants(3)).toBe("3 участника");
    expect(pluralParticipants(4)).toBe("4 участника");
    expect(pluralParticipants(5)).toBe("5 участников");
    expect(pluralParticipants(11)).toBe("11 участников");
    expect(pluralParticipants(12)).toBe("12 участников");
    expect(pluralParticipants(21)).toBe("21 участник");
    expect(pluralParticipants(22)).toBe("22 участника");
    expect(pluralParticipants(0)).toBe("0 участников");
  });
});
