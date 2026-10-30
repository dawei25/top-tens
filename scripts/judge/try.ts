// Play guesses against a built puzzle with the game's real matcher, in order, like a player would: found answers
// stay found, lives drop on costly misses, a clear misspelling is confirmed the way the game asks the player to.
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/judge/try.ts <id> "guess one" "guess two" ...
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lexicon } from "../../src/game/junk";
import { judgeGuess } from "../../src/game/match";
import { loadBuilt } from "./packet";

const DIR = join(import.meta.dirname, "..", "..", "public", "puzzles");

export function play(id: string, guesses: string[]): string[] {
  const p = loadBuilt(id);
  const lex: Lexicon = JSON.parse(readFileSync(join(DIR, "lexicon.json"), "utf8"));
  const found = new Set<number>();
  let lives = 5;
  const out: string[] = [];
  for (const g of guesses) {
    const r = judgeGuess(g, p, found, lex);
    let text: string;
    switch (r.kind) {
      case "correct":
        found.add(r.entry.rank);
        text = `TOP 10 #${r.entry.rank} ${r.entry.name}${r.corrected ? " (after the game corrected the spelling)" : ""}`;
        break;
      case "duplicate":
        text = `already found (#${r.entry.rank} ${r.entry.name}), free`;
        break;
      case "near":
        if (!r.corrected) lives--;
        text = r.corrected
          ? `corrected to ${r.entry.name} (rank ${r.entry.rank > 10 ? `#${r.entry.rank}` : "unranked"}); would cost a life if confirmed`
          : `MISS, costs a life: ${r.entry.name} is ${r.entry.rank > 10 ? `#${r.entry.rank}` : "an accepted answer outside the ranking"}`;
        break;
      case "typo":
        text = `ambiguous, the game offers: ${r.suggestions.join(" / ")} (free)`;
        break;
      case "unknown":
        text = r.junk ? "junk, free" : "NOT RECOGNIZED, free (the game says it isn't an answer for this list)";
        break;
      default:
        text = r.kind;
    }
    out.push(`"${g}" -> ${text}`);
  }
  out.push(`RESULT: ${found.size}/10 found, ${lives} lives left${lives <= 0 ? " (game over before the end)" : ""}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, ...guesses] = process.argv.slice(2);
  if (!id || !guesses.length) throw new Error('usage: try.ts <id> "guess" ...');
  console.log(play(id, guesses).join("\n"));
}
