// Checks against the built puzzle bank in public/puzzles.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Lexicon } from "./junk";
import { judgeGuess } from "./match";
import type { Puzzle } from "./types";

const dir = join(import.meta.dirname, "../../public/puzzles");
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(dir, f), "utf8"));
const lex = read<Lexicon>("lexicon.json");
const judge = (id: string, guess: string) => judgeGuess(guess, read<Puzzle>(`${id}.json`), new Set(), lex);

describe("built puzzles", () => {
  it("video games: number-aware matching", () => {
    expect(judge("video-games", "gta5")).toMatchObject({ kind: "correct", entry: { name: "Grand Theft Auto V" } });
    expect(judge("video-games", "gta v")).toMatchObject({ kind: "correct", entry: { name: "Grand Theft Auto V" } });
    expect(judge("video-games", "gta 6").kind).not.toBe("correct");
    expect(judge("video-games", "grand theft auto").kind).not.toBe("near");
    expect(judge("video-games", "skyrim")).toMatchObject({ kind: "correct" });
  });

  it("countries: every country is an accepted answer, so wrong ones cost a life", () => {
    expect(judge("countries-area", "Austria")).toMatchObject({ kind: "near", entry: { name: "Austria" } });
    expect(judge("countries-population", "Fiji")).toMatchObject({ kind: "near" });
    expect(judge("countries-population", "Liechtenstein")).toMatchObject({ kind: "near" });
    expect(judge("countries-population", "Elon Musk").kind).toBe("unknown");
    expect(judge("countries-population", "asdf")).toMatchObject({ kind: "unknown", junk: true });
  });
});

describe("codes", () => {
  it("keyboard mash never fuzzy-matches an airport code", () => {
    expect(judge("airports", "asdf")).toMatchObject({ kind: "unknown", junk: true });
    expect(judge("airports", "ATL")).toMatchObject({ kind: "correct" });
  });
});

describe("first names and partial names", () => {
  it.each([
    ["wilt", "Wilt Chamberlain"],
    ["kareem", "Kareem Abdul-Jabbar"],
    ["dirk", "Dirk Nowitzki"],
    ["kobe", "Kobe Bryant"],
    ["kobe brynt", "Kobe Bryant"],
  ])("nba-points: %s -> %s", (guess, name) => {
    expect(judge("nba-points", guess)).toMatchObject({ kind: "correct", entry: { name } });
  });

  it("a shared first name offers the choices", () => {
    expect(judge("nba-points", "kevin")).toMatchObject({ kind: "typo", suggestions: ["Kevin Durant", "Kevin Garnett"] });
  });
});

describe("intent edge cases", () => {
  it("a misspelled first name fills its own entry, not a lookalike surname", () => {
    expect(judge("nba-points", "kareen")).toMatchObject({ kind: "correct", corrected: true, entry: { name: "Kareem Abdul-Jabbar" } });
  });
  it("an exact title beats other entries' aliases", () => {
    expect(judge("films-gross", "avatar")).toMatchObject({ kind: "correct", entry: { name: "Avatar" } });
  });
  it("spacing never matters", () => {
    const r = judge("films-gross", "spiderman");
    expect(r.kind).toBe("typo");
    if (r.kind === "typo") expect(r.suggestions.every((s) => s.startsWith("Spider-Man"))).toBe(true);
  });
  it("never lists more than two choices for a misspelling", () => {
    for (const g of ["kareem", "jams", "harde", "malon"]) {
      const r = judge("nba-points", g);
      if (r.kind === "typo") expect(r.suggestions.length).toBeLessThanOrEqual(2);
    }
  });
});
