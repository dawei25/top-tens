import { describe, expect, it } from "vitest";
import { ago, cleanName, homeName, homeNote, HOME_NAME_MAX, syncLabel } from "./labels";

describe("homeName (Home's 'signed in as')", () => {
  it("shows the display name, else the email's part before the @, and never a whole address", () => {
    expect(homeName({ name: "Dana Scully", email: "dana@example.com" })).toBe("Dana Scully");
    expect(homeName({ name: "", email: "fox.mulder@example.com" })).toBe("fox.mulder");
    // A name that is (or holds) an address is cut at the @.
    expect(homeName({ name: "fox.mulder@example.com", email: "fox.mulder@example.com" })).toBe("fox.mulder");
    expect(homeName({ name: "  agent  @fbi.gov" })).toBe("agent");
    expect(homeName({ name: "@example.com", email: "fox@example.com" })).toBe("fox");
    expect(homeName({ name: "" })).toBe("player");
    for (const n of ["dana@example.com", "a@b.c", "Dana Scully <dana@example.com>"]) expect(homeName({ name: n })).not.toContain("@");
  });
  it("cuts a long name short", () => {
    const long = homeName({ name: "Maximiliana Wolfeschlegelsteinhausenbergerdorff" });
    expect(long.length).toBeLessThanOrEqual(HOME_NAME_MAX);
    expect(long).toBe("Maximiliana Wolfeschl...");
    expect(homeName({ name: "x".repeat(HOME_NAME_MAX) })).toBe("x".repeat(HOME_NAME_MAX));
  });
});

describe("homeNote (the line under Home's account status)", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  it("says where games are kept, and the sync state in plain words", () => {
    expect(homeNote({ status: "out", sync: "idle" })).toBe("games are saved on this device only.");
    expect(homeNote({ status: "out", sync: "idle", notice: "sign-in didn't finish. try again." })).toBe("sign-in didn't finish. try again.");
    expect(homeNote({ status: "loading", sync: "idle" })).toBe("checking your sign-in.");
    expect(homeNote({ status: "in", sync: "idle" })).toBe("your games sync to this account.");
    expect(homeNote({ status: "in", sync: "syncing" })).toBe("syncing your games.");
    expect(homeNote({ status: "in", sync: "synced", syncedAt: now - 4 * 60_000 }, now)).toBe("games synced 4 min ago.");
    expect(homeNote({ status: "in", sync: "offline" })).toBe("offline. games sync when you're back online.");
    expect(homeNote({ status: "in", sync: "error" })).toBe("couldn't sync. it tries again after your next game.");
  });
  it("uses no em dashes or emoji (UI copy rule)", () => {
    for (const status of ["out", "loading", "in"] as const) {
      for (const sync of ["idle", "syncing", "synced", "offline", "error"] as const) {
        expect(homeNote({ status, sync, syncedAt: now }, now)).not.toMatch(/[—\u{1F300}-\u{1FAFF}]/u);
      }
    }
  });
});

describe("ago", () => {
  it("says how long ago, briefly", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(ago(now - 2 * 3_600_000, now)).toBe("2 h ago");
  });
});

describe("cleanName", () => {
  it("tidies spaces and keeps names of 1 to 24 characters", () => {
    expect(cleanName("  Agent   Scully ")).toBe("Agent Scully");
    expect(cleanName("x".repeat(24))).toBe("x".repeat(24));
    expect(cleanName("x".repeat(25))).toBeNull();
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("bad\u0007name")).toBeNull();
    expect(cleanName("Zoë Ångström")).toBe("Zoë Ångström");
  });
});

describe("syncLabel", () => {
  it("says the sync state in a few words", () => {
    expect(["idle", "syncing", "synced", "offline", "error"].map((sync) => syncLabel({ sync: sync as never }))).toEqual([
      "signed in",
      "syncing",
      "synced",
      "offline",
      "sync failed",
    ]);
  });
});
