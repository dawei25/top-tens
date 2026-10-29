// Saves the opening paragraphs of every top-10 entry's Wikipedia article, as source material for writing facts.
// Usage: NODE_NO_WARNINGS=1 NODE_USE_ENV_PROXY=1 npx tsx scripts/leads.ts [topic-id ...]
// Writes .cache/leads/<topic id>.json: [{ rank, name, article, url, lead }]. Uses the cached, throttled fetcher.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Puzzle } from "../src/game/types";
import { cleanText } from "./table";
import { fetchPage, pageUrl } from "./wiki";

const PUZZLES = join(import.meta.dirname, "..", "public", "puzzles");
const OUT = join(import.meta.dirname, "..", ".cache", "leads");
const LEAD_CHARS = 2500;

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
for (const f of readdirSync(PUZZLES)) {
  if (!f.endsWith(".json") || f === "index.json" || f === "lexicon.json") continue;
  const p: Puzzle = JSON.parse(readFileSync(join(PUZZLES, f), "utf8"));
  if (only.length && !only.includes(p.id)) continue;
  const out = [];
  for (const e of p.answers) {
    const article = e.article ?? e.name;
    let lead = "";
    try {
      const $ = await fetchPage(article);
      $(".mw-parser-output > p")
        .toArray()
        .some((el) => {
          lead += cleanText($(el).text()) + "\n";
          return lead.length > LEAD_CHARS;
        });
    } catch (err) {
      lead = `(could not fetch: ${(err as Error).message})`;
    }
    out.push({ rank: e.rank, name: e.name, value: e.value, article, url: pageUrl(article), lead: lead.trim().slice(0, LEAD_CHARS) });
  }
  writeFileSync(join(OUT, `${p.id}.json`), JSON.stringify({ title: p.title, prompt: p.prompt, metric: p.metric, entries: out }, null, 1));
  console.log(`ok ${p.id}`);
}
