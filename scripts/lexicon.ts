// Trains the junk-guess model from an English word list plus every puzzle in public/puzzles.
// Usage: npx tsx scripts/lexicon.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fnv, trainLexicon } from "../src/game/junk";
import { normalize } from "../src/game/match";
import { capitals, countries } from "./gazetteer";
import type { Puzzle } from "../src/game/types";

const require = createRequire(import.meta.url);

/**
 * Every name and alias in the bank. `ranked` is the part from the source tables (ranked entries); the rest are
 * unranked pool members (universes, other tables, category members), thousands of them in some puzzles.
 */
export function bankNames(dir: string): { ranked: string[]; all: string[] } {
  const ranked: string[] = [];
  const all: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "index.json" || f === "lexicon.json") continue;
    const p: Puzzle = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const e of [...p.answers, ...p.extras]) {
      const forms = [e.name, ...e.aliases];
      all.push(...forms);
      if (e.rank > 0) ranked.push(...forms);
    }
  }
  return { ranked, all };
}

export function writeLexicon(dir: string): number {
  const words: string[] = require("an-array-of-english-words");
  // Countries and capitals too, so "Fiji" or "Ljubljana" never reads as junk.
  const places = [...countries().flatMap((c) => [c.name, ...c.aliases]), ...capitals()];
  const { ranked, all } = bankNames(dir);
  // The letter model learns from the ranked names only, so huge unranked pools (every YouTuber with an article)
  // don't skew what a plausible word looks like. Every name still counts as known.
  // Weight 2, not the default 5: the ranked bank is several times bigger than when the threshold was tuned.
  const lex = trainLexicon(words, [...ranked, ...places], 2);
  const known = new Set(lex.names.split(" "));
  for (const n of all) {
    const s = normalize(n);
    if (s) known.add(fnv(s).toString(36));
  }
  lex.names = [...known].join(" ");
  writeFileSync(join(dir, "lexicon.json"), JSON.stringify(lex));
  return all.length + places.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(import.meta.dirname, "..", "public", "puzzles");
  console.log(`trained on ${writeLexicon(dir)} names`);
}
