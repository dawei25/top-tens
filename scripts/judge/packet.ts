// The judge's view of one built puzzle: what the player sees, the top 10 with their aliases, the wider answer pool,
// and the Blitz stats. Read-only; prints text for the list judge (docs/JUDGE.md).
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/judge/packet.ts <id>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyEntry } from "../../src/game/daily";
import type { Entry, Puzzle } from "../../src/game/types";

const DIR = join(import.meta.dirname, "..", "..", "public", "puzzles");

export function loadBuilt(id: string): Puzzle {
  return JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"));
}

function line(e: Entry): string {
  const value = e.value ? `  ${e.value}` : "";
  const aliases = e.aliases.length ? `  [aliases: ${e.aliases.slice(0, 8).join(", ")}${e.aliases.length > 8 ? `, +${e.aliases.length - 8}` : ""}]` : "";
  return `#${e.rank} ${e.name}${value}${aliases}`;
}

export function packet(id: string): string {
  const p = loadBuilt(id);
  const schedule: DailyEntry[] = JSON.parse(readFileSync(join(DIR, "daily.json"), "utf8"));
  const ran = schedule.filter((e) => e.id === id || e.blitz === id).map((e) => `#${e.n} on ${e.date}${e.blitz === id ? " (as Today's Blitz)" : ""}`);
  const ranked = p.extras.filter((e) => e.rank > 10).sort((a, b) => a.rank - b.rank);
  const unranked = p.extras.filter((e) => !(e.rank > 10));
  const scoring = [...p.answers, ...p.extras].filter((e) => e.n !== undefined).length;
  const out = [
    `ID: ${p.id}`,
    `TITLE: ${p.title}`,
    `PROMPT (shown to the player): ${p.prompt}`,
    `CATEGORY: ${p.category ?? "(none)"}`,
    `METRIC: ${p.metric ?? "(none)"}${p.lowerIsBetter ? " (lower is better)" : ""}`,
    `SOURCE: ${p.source.name} <${p.source.url}>, data as of ${p.source.dataAsOf ?? p.source.asOf}`,
    `BLITZ-READY: ${p.blitz ? "yes" : "no"}; ${scoring} answers carry a stat (score in Blitz)`,
    `ALREADY RAN: ${ran.length ? ran.join("; ") : "never"}`,
    ``,
    `TOP 10 (the answers to find):`,
    ...p.answers.map(line),
    ``,
    `RANKS 11+ (accepted, cost a life in classic; score in Blitz): ${ranked.length} entries. First 40:`,
    ...ranked.slice(0, 40).map(line),
    ``,
    `UNRANKED ACCEPTED ANSWERS (cost a life in classic, score nothing): ${unranked.length}. Sample: ${unranked
      .slice(0, 30)
      .map((e) => e.name)
      .join(", ")}`,
  ];
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  if (!id) throw new Error("usage: packet.ts <id>");
  console.log(packet(id));
}
