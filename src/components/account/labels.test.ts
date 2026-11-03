import { describe, expect, it } from "vitest";
import { cleanName, syncLabel } from "./labels";

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
