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
    // An archive day (since Nov 16 the wall holds those back too, once the free games are used up).
    expect(readAsk({ kind: "daily", date: "2026-11-08", at: now }, now)).toEqual({ kind: "daily", date: "2026-11-08" });
  });
  it("an archive day's ask names a date and nothing else", () => {
    for (const date of [undefined, "", "2026-11-8", "#archive", "2026-11-08/x"]) expect(readAsk({ kind: "daily", date, at: now }, now)).toBeNull();
    expect(readAsk({ kind: "daily", date: "2026-11-08", at: now - ASK_TTL - 1 }, now)).toBeNull();
  });
  it("reads an old Play Blitz ask (a list's results offered its Blitz until Nov 14) as no ask", () => {
    expect(readAsk({ kind: "open", mode: "blitz", id: "airports", at: now }, now)).toBeNull();
  });
  it("drops a stale one, one from the future, and anything malformed", () => {
    expect(readAsk({ kind: "roll", mode: "list", at: now - ASK_TTL - 1 }, now)).toBeNull();
    expect(readAsk({ kind: "roll", mode: "list", at: now + 120_000 }, now)).toBeNull();
    for (const bad of [null, "roll", { kind: "roll", mode: "fathom", at: now }, { kind: "replay", mode: "list", at: now }, { kind: "replay", mode: "list", id: "../x", at: now }, { kind: "go", mode: "list", id: "a", at: now }, { kind: "roll", mode: "list" }]) {
      expect(readAsk(bad, now)).toBeNull();
    }
  });
});
