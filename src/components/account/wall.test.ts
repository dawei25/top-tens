import { describe, expect, it } from "vitest";
import { ASK_TTL, readAsk } from "./wall";

// The game a player asked for at the wall, kept across a sign-in that leaves the page: only a well-formed, fresh ask
// comes back, so a stale or hand-edited one never starts a game on arrival.
describe("the ask kept across a full-page sign-in", () => {
  const now = 1_000_000_000;
  it("reads back each kind", () => {
    expect(readAsk({ kind: "roll", mode: "list", at: now }, now)).toEqual({ kind: "roll", mode: "list" });
    expect(readAsk({ kind: "roll", mode: "blitz", category: "Geography", leave: "airports", at: now }, now)).toEqual({
      kind: "roll",
      mode: "blitz",
      category: "Geography",
      leave: "airports",
    });
    expect(readAsk({ kind: "replay", mode: "list", id: "mountains", at: now }, now)).toEqual({ kind: "replay", mode: "list", id: "mountains" });
    expect(readAsk({ kind: "open", mode: "blitz", id: "airports", at: now }, now)).toEqual({ kind: "open", mode: "blitz", id: "airports" });
  });
  it("drops a stale one, one from the future, and anything malformed", () => {
    expect(readAsk({ kind: "roll", mode: "list", at: now - ASK_TTL - 1 }, now)).toBeNull();
    expect(readAsk({ kind: "roll", mode: "list", at: now + 120_000 }, now)).toBeNull();
    for (const bad of [null, "roll", { kind: "roll", mode: "fathom", at: now }, { kind: "open", mode: "list", at: now }, { kind: "open", mode: "list", id: "../x", at: now }, { kind: "go", mode: "list", id: "a", at: now }, { kind: "roll", mode: "list" }]) {
      expect(readAsk(bad, now)).toBeNull();
    }
  });
});
