import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Entry, Puzzle } from "../game/types";
import { nextRanks } from "./nextRanks";

const entry = (rank: number, name = `#${rank}`): Entry => ({ rank, name, aliases: [] });
const list = (...ranks: number[]) => ({ extras: ranks.map((r, i) => entry(r, `e${i}`)) });

describe("nextRanks: ranks 11 to 20 under a finished list (owner, Nov 14: shown directly, no key)", () => {
  it("takes ranks 11 to 20 in rank order and labels the span", () => {
    const r = nextRanks(list(14, 0, 11, 25, 20, 12, 13, 15, 16, 17, 18, 19, 21, 0));
    expect(r?.rows.map((e) => e.rank)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(r?.label).toBe("11 to 20");
    expect(r?.name).toBe("Ranks 11 to 20");
  });

  it('says how far the list goes when it stops sooner ("11 to 15")', () => {
    const r = nextRanks(list(15, 13, 11, 12, 14, 0, 0));
    expect(r?.rows.map((e) => e.rank)).toEqual([11, 12, 13, 14, 15]);
    expect(r?.label).toBe("11 to 15");
  });

  it("keeps ties as rows of their own, and a single rank reads as one", () => {
    const tied = nextRanks(list(11, 11, 11));
    expect(tied?.rows).toHaveLength(3);
    expect(tied?.label).toBe("#11");
    expect(tied?.name).toBe("Rank 11");
    expect(nextRanks(list(13, 12, 12))?.rows.map((e) => e.rank)).toEqual([12, 12, 13]);
  });

  it("is null for a list with nothing ranked 11 to 20", () => {
    expect(nextRanks(list())).toBeNull();
    expect(nextRanks(list(0, 0, 21, 40))).toBeNull();
  });

  it("never touches the top 10 or reorders the puzzle", () => {
    const p = list(12, 11);
    nextRanks(p);
    expect(p.extras.map((e) => e.rank)).toEqual([12, 11]);
    expect(nextRanks({ extras: [entry(10), entry(1)] })).toBeNull();
  });

  // Every built list: a label that starts at its first row and ends at its last, never past 20.
  it("labels every built list truthfully", () => {
    const dir = join(__dirname, "../../public/puzzles");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const p = JSON.parse(readFileSync(join(dir, f), "utf8")) as Puzzle;
      if (!Array.isArray(p.extras)) continue;
      const r = nextRanks(p);
      if (!r) continue;
      const [first, last] = [r.rows[0].rank, r.rows.at(-1)!.rank];
      expect(first, p.id).toBeGreaterThanOrEqual(11);
      expect(last, p.id).toBeLessThanOrEqual(20);
      expect(r.label, p.id).toBe(first === last ? `#${first}` : `${first} to ${last}`);
    }
  });
});
