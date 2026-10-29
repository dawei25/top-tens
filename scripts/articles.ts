// Saves source material for writing facts: each top-10 entry's full article text (by section, minus references and
// other boilerplate) and its "Did you know" hook if the article was featured on the Main Page.
// Usage: NODE_NO_WARNINGS=1 NODE_USE_ENV_PROXY=1 npx tsx scripts/articles.ts [--test | topic-id ...]
// Writes .cache/articles/<topic id>.json. Uses the cached, throttled fetcher (one talk page per entry is new).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Puzzle } from "../src/game/types";
import { cleanText } from "./table";
import { TEST_SET } from "./topics";
import { fetchPage, pageUrl } from "./wiki";

const PUZZLES = join(import.meta.dirname, "..", "public", "puzzles");
const OUT = join(import.meta.dirname, "..", ".cache", "articles");
const MAX_CHARS = 20000;
const SKIP_SECTIONS = /^(see also|notes|references|citations|sources|further reading|external links|bibliography|footnotes|works cited)$/i;

async function articleText(title: string): Promise<string> {
  const $ = await fetchPage(title);
  let out = "";
  let section = "Introduction";
  $(".mw-parser-output")
    .find("h2, h3, p, li")
    .each((_, el) => {
      if (out.length > MAX_CHARS) return false;
      const $el = $(el);
      if (el.tagName === "h2" || el.tagName === "h3") {
        section = cleanText($el.text());
        if (!SKIP_SECTIONS.test(section)) out += `\n## ${section}\n`;
        return;
      }
      if (SKIP_SECTIONS.test(section) || $el.closest("table, .navbox, .reflist, .infobox, .sidebar").length) return;
      const text = cleanText($el.text());
      if (text.length > 40) out += text + "\n";
    });
  return out.trim().slice(0, MAX_CHARS);
}

async function dykHook(title: string): Promise<string | undefined> {
  try {
    const $ = await fetchPage(`Talk:${title}`);
    const m = cleanText($(".mw-parser-output").text()).match(/\.\.\.\s*that[^?]{10,400}\?/i);
    return m?.[0];
  } catch {
    return undefined;
  }
}

mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const only = args.includes("--test") ? TEST_SET : args;
for (const id of only) {
  const p: Puzzle = JSON.parse(readFileSync(join(PUZZLES, `${id}.json`), "utf8"));
  const entries = [];
  for (const e of p.answers) {
    const article = e.article ?? e.name;
    let text = "";
    try {
      text = await articleText(article);
    } catch (err) {
      text = `(could not fetch: ${(err as Error).message})`;
    }
    entries.push({ rank: e.rank, name: e.name, value: e.value, url: pageUrl(article), dyk: await dykHook(article), current: e.fact?.text, text });
  }
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify({ title: p.title, prompt: p.prompt, metric: p.metric, entries }, null, 1));
  console.log(`ok ${id}: ${entries.filter((e) => e.dyk).length} DYK hooks`);
}
