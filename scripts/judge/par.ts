// Estimated score distributions per list, until real players' scores exist: a seeded synthetic crowd built from the
// list judge's simulated players (docs/JUDGE.md). Writes public/puzzles/par.json, which the game reads for "par" and
// the results histogram. Rerun after judging: NODE_NO_WARNINGS=1 npx tsx scripts/judge/par.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ParFile } from "../../src/game/par";

const VERDICTS = join(import.meta.dirname, "verdicts");
const OUT = join(import.meta.dirname, "..", "..", "public", "puzzles", "par.json");
const CROWD = 1000;

interface Verdict {
  id: string;
  difficulty?: number;
  tags?: string[];
  casual?: { found?: number } | null;
  fan?: { found?: number } | null;
}

/** Deterministic per list, so every player sees the same histogram. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * The crowd: most players a couple of answers below the judge's casual player (a model that knows more than it
 * admits and never blanks; real players average lower), some in between, a few fans. Scores are whole answers,
 * 0 to 10.
 */
export function crowd(v: Verdict): number[] {
  const casual = v.casual?.found ?? 5;
  const fan = v.fan?.found ?? Math.min(10, casual + 3);
  const groups: [share: number, mean: number, spread: number][] = [
    [0.6, Math.max(0, casual - 2), 2],
    [0.3, Math.max(0, (casual + fan) / 2 - 1.5), 1.6],
    [0.1, fan - 0.5, 1.2],
  ];
  const r = rng(v.id);
  const normal = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const counts = Array(11).fill(0);
  for (const [share, mean, spread] of groups) {
    for (let i = 0; i < Math.round(CROWD * share); i++) {
      counts[Math.min(10, Math.max(0, Math.round(mean + spread * normal())))]++;
    }
  }
  return counts;
}

function median(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  let seen = 0;
  for (let s = 0; s <= 10; s++) if ((seen += counts[s]) * 2 >= total) return s;
  return 10;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out: ParFile = {};
  for (const f of readdirSync(VERDICTS).filter((f) => f.endsWith(".json")).sort()) {
    const v: Verdict = JSON.parse(readFileSync(join(VERDICTS, f), "utf8"));
    const counts = crowd(v);
    out[v.id] = { par: median(counts), counts, difficulty: v.difficulty, tags: v.tags, estimated: true };
  }
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`${Object.keys(out).length} lists -> public/puzzles/par.json`);
}
