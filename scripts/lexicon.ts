// Trains the junk-guess model from an English word list plus every puzzle in public/puzzles.
// Usage: npx tsx scripts/lexicon.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { trainLexicon } from "../src/game/junk";
import type { Puzzle } from "../src/game/types";

const require = createRequire(import.meta.url);

export function bankNames(dir: string): string[] {
  const names: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "index.json" || f === "lexicon.json") continue;
    const p: Puzzle = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const e of [...p.answers, ...p.extras]) names.push(e.name, ...e.aliases);
  }
  return names;
}

/** Every country and capital, so "Fiji" or "Ljubljana" never reads as junk in a list that doesn't include them. */
function gazetteer(): string[] {
  const { countries } = require("countries-list") as {
    countries: Record<string, { name: string; native: string; capital: string }>;
  };
  return Object.values(countries).flatMap((c) => [c.name, c.native, c.capital].filter(Boolean));
}

export function writeLexicon(dir: string): number {
  const words: string[] = require("an-array-of-english-words");
  const names = [...bankNames(dir), ...gazetteer()];
  writeFileSync(join(dir, "lexicon.json"), JSON.stringify(trainLexicon(words, names)));
  return names.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(import.meta.dirname, "..", "public", "puzzles");
  console.log(`trained on ${writeLexicon(dir)} names`);
}
