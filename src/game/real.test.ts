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
