// Unranked answers that may deserve a rank or a value: pool entries (rank 0) without a stat whose name also appears
// in a table of the topic's own cached page next to a number. Each hit is either a parse problem (a second table,
// another column, a name form the ranking missed) or a table that ranks by something else.
// Reads only the cache; fetches nothing.
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/audit-unranked.ts [topic-id ...] [--also] [--all]
//   --also  also read the pages of the topic's `also` sources
//   --all   also list unranked entries that already carry a value
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/game/match";
import type { Entry, Puzzle } from "../src/game/types";
import { splitHeader, tableGrid, wikitables } from "./table";
import { TOPICS } from "./topics";
import { fetchPage, NotFound } from "./wiki";

const DIR = join(import.meta.dirname, "..", "public", "puzzles");
const args = process.argv.slice(2);
const withAlso = args.includes("--also");
const withValued = args.includes("--all");
const only = args.filter((a) => !a.startsWith("--"));

/** A number worth reporting: not a bare year, not a rank-sized integer in a "Rank"/"No." column. */
function numberIn(text: string): string | null {
  const m = text.match(/[$€£]?\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|trillion))?/i);
  if (!m) return null;
  const digits = m[0].replace(/[^\d.]/g, "");
  if (/^(1[5-9]|20)\d\d$/.test(digits) && m[0].trim() === digits) return null;
  return m[0].trim();
}

interface Hit {
  entry: string;
  page: string;
  table: number;
  heading: string;
  cells: string[];
}

async function audit(id: string): Promise<{ hits: Hit[]; unranked: number }> {
  const topic = TOPICS.find((t) => t.id === id)!;
  const file = join(DIR, `${id}.json`);
  if (!existsSync(file)) return { hits: [], unranked: 0 };
  const p: Puzzle = JSON.parse(readFileSync(file, "utf8"));
  const pool = p.extras.filter((e) => e.rank === 0 && (withValued || e.n === undefined));
  // Every form of every unranked entry, normalized, to the entry. Forms shared with a ranked entry are left out.
  const ranked = new Set([...p.answers, ...p.extras].filter((e) => e.rank > 0).flatMap((e) => [e.name, ...e.aliases]).map(normalize));
  const byForm = new Map<string, Entry>();
  for (const e of pool) for (const f of [e.name, ...e.aliases].map(normalize)) if (f && !ranked.has(f)) byForm.set(f, e);

  const pages = [topic.page, ...(withAlso ? (topic.also ?? []).map((a) => a.page ?? topic.page) : [])];
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const page of [...new Set(pages)]) {
    let $;
    try {
      $ = await fetchPage(page, true);
    } catch (e) {
      if (e instanceof NotFound) {
        console.log(`  (${page} is not cached)`);
        continue;
      }
      throw e;
    }
    for (const [ti, table] of wikitables($).entries()) {
      const { header, body } = splitHeader(tableGrid($, table));
      const heading = $(table).find("caption").first().text().trim() || $(table).prevAll("h2, h3, div.mw-heading").first().text().trim();
      for (const row of body) {
        for (const [ci, cell] of row.entries()) {
          if (!cell) continue;
          const forms = [cell.text, cell.linkText ?? "", cell.link ?? "", ...cell.lines].map((s) => normalize(s.replace(/\s*\(.*?\)\s*/g, " ")));
          const e = forms.map((f) => byForm.get(f)).find(Boolean);
          if (!e) continue;
          const nums = row
            .map((c, j) => (j === ci || !c ? null : numberIn(c.text) && `${header[j] || `col ${j}`}: ${c.text.slice(0, 40)}`))
            .filter((x): x is string => !!x);
          const key = `${e.name}|${page}|${ti}`;
          if (!nums.length || seen.has(key)) continue;
          seen.add(key);
          hits.push({ entry: e.name, page, table: ti, heading: heading.slice(0, 60), cells: [...new Set(nums)] });
        }
      }
    }
  }
  return { hits, unranked: pool.length };
}

let total = 0;
for (const t of TOPICS) {
  if (only.length && !only.includes(t.id)) continue;
  const { hits, unranked } = await audit(t.id);
  if (!hits.length) continue;
  total += hits.length;
  console.log(`\n${t.id}: ${new Set(hits.map((h) => h.entry)).size} of ${unranked} unranked entries without a stat appear in a table with a number`);
  for (const h of hits.slice(0, 40)) {
    const where = h.page === t.page ? `table ${h.table}` : `${h.page} table ${h.table}`;
    console.log(`  ${h.entry}  [${where}: ${h.heading}]  ${h.cells.slice(0, 4).join(" | ")}`);
  }
  if (hits.length > 40) console.log(`  ... ${hits.length - 40} more`);
}
console.log(`\n${total} hit(s)`);
