import { describe, expect, it } from "vitest";
import { accountAlert, accountKeyLabel, ago, cleanName, homeName, HOME_NAME_MAX, syncLabel } from "./labels";

describe("homeName (the account key's 'signed in as')", () => {
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

describe("Home's account key: its words (name and title) and its pink dot", () => {
  const dana = { id: "u1", name: "Dana Scully", email: "dana@example.com" };
  const SYNCS = ["idle", "syncing", "synced", "offline", "error"] as const;
  it("says the state: not signed in, signing in, signed in as the player's name", () => {
    expect(accountKeyLabel({ status: "out", sync: "idle" })).toBe("Account: not signed in");
    expect(accountKeyLabel({ status: "loading", sync: "idle" })).toBe("Account: signing in");
    for (const sync of ["idle", "syncing", "synced"] as const) {
      expect(accountKeyLabel({ status: "in", user: dana, sync })).toBe("Account: signed in as Dana Scully");
    }
    expect(accountKeyLabel({ status: "in", user: { id: "u2", name: "", email: "fox@example.com" }, sync: "synced" })).toBe("Account: signed in as fox");
  });
  it("says what the pink dot means, and shows it only when something needs a look", () => {
    expect(accountKeyLabel({ status: "in", user: dana, sync: "offline" })).toBe("Account: signed in as Dana Scully, offline");
    expect(accountKeyLabel({ status: "in", user: dana, sync: "error" })).toBe("Account: signed in as Dana Scully, couldn't sync");
    expect(accountKeyLabel({ status: "out", sync: "idle", notice: "sign-in failed: some server words." })).toBe(
      "Account: not signed in, sign-in didn't finish",
    );
    expect(SYNCS.filter((sync) => accountAlert({ status: "in", sync }))).toEqual(["offline", "error"]);
    expect(accountAlert({ status: "out", sync: "idle" })).toBe(false);
    expect(accountAlert({ status: "out", sync: "idle", notice: "sign-in didn't finish. try again." })).toBe(true);
    expect(accountAlert({ status: "loading", sync: "idle", notice: "x" })).toBe(false);
    expect(accountAlert({ status: "off", sync: "error" })).toBe(false);
  });
  it("never says an email address, uses no em dashes or emoji (UI copy rule)", () => {
    const users = [dana, { id: "u3", name: "dana@example.com", email: "dana@example.com" }, { id: "u4", name: "", email: "a@b.c" }];
    for (const status of ["out", "loading", "in"] as const) {
      for (const sync of SYNCS) {
        for (const user of users) {
          const label = accountKeyLabel({ status, user: status === "in" ? user : undefined, sync, notice: "sent to dana@example.com" });
          expect(label).not.toContain("@");
          expect(label).not.toMatch(/[—\u{1F300}-\u{1FAFF}]/u);
        }
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
