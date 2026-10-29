// Builds public/puzzles/*.json from the Wikipedia tables listed in topics.ts.
// Usage: npm run build:puzzles [-- topic-id ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry, Puzzle } from "../src/game/types";
import { normalize } from "../src/game/match";
import { cleanText, splitHeader, tableGrid, wikitables, type Cell } from "./table";
import { TOPICS, type Topic } from "./topics";
import { fetchPage, fetchRedirects, pageUrl } from "./wiki";

const OUT_DIR = join(import.meta.dirname, "..", "public", "puzzles");
const EXTRAS = 40;

interface Row {
  name: string;
  value: number;
  valueText: string;
  aliasSeeds: string[];
  redirectTarget: string;
}

function column(header: string[], spec: string | number): number {
  if (typeof spec === "number") return spec;
  const i = header.findIndex((h) => h.toLowerCase().includes(spec.toLowerCase()));
  if (i < 0) throw new Error(`no column matching "${spec}" in [${header.join(" | ")}]`);
  return i;
}

function cleanName(s: string): string {
  return cleanText(s)
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[†‡*^#⁂§¤]+/g, "")
    .replace(/^"|"$/g, "")
    .trim();
}

function parseValue(text: string): { value: number; display: string } | null {
  const m = text.match(/([$€£]?)\s*(\d[\d,]*(?:\.\d+)?)\s*(million|billion|trillion)?/i);
  if (!m) return null;
  const mult = { million: 1e6, billion: 1e9, trillion: 1e12 }[m[3]?.toLowerCase() ?? ""] ?? 1;
  const digits = m[2].replace(/^0+(?=\d)/, "");
  return {
    value: parseFloat(digits.replace(/,/g, "")) * mult,
    display: `${m[1]}${digits}${m[3] ? " " + m[3].toLowerCase() : ""}`,
  };
}

function cellName(cell: Cell, topic: Topic): string {
  return cleanName(topic.nameFromText || !cell.linkText ? cell.text : cell.linkText);
}

/** Use the linked article for redirects only if it is about the thing itself ("Avatar (2009 film)", not "Demographics of India"). */
function redirectTarget(name: string, cell: Cell): string {
  if (cell.link && normalize(cleanName(cell.link)) === normalize(name)) return cell.link;
  return name;
}

async function readRows(topic: Topic): Promise<Row[]> {
  const $ = await fetchPage(topic.page);
  const tables = wikitables($);
  const rows: Row[] = [];
  for (const t of topic.tables) {
    const { header, body } = splitHeader(tableGrid($, tables[t]));
    const nc = column(header, topic.name);
    const vc = column(header, topic.value);
    const aliasCs = (topic.aliasCols ?? []).map((a) => column(header, a));
    for (const r of body) {
      const nameCell = r[nc];
      const valueCell = r[vc];
      if (!nameCell || !valueCell || nameCell.isHeader && !nameCell.text) continue;
      if (topic.rankedOnly && !/^\d/.test(r[0]?.text ?? "")) continue;
      const name = cellName(nameCell, topic);
      if (!name || topic.skip?.includes(name)) continue;
      const v = parseValue(valueCell.text);
      if (!v) continue;
      const seeds = [nameCell.text, nameCell.linkText ?? ""];
      for (const c of aliasCs) {
        const cell = r[c];
        if (cell) seeds.push(cell.linkText ?? "", ...cell.text.split(/[/,]/));
      }
      rows.push({
        name,
        value: v.value,
        valueText: v.display,
        aliasSeeds: seeds.map(cleanName).filter((s) => s && s.length > 1),
        redirectTarget: redirectTarget(name, nameCell),
      });
    }
  }
  if (!topic.keepOrder) rows.sort((a, b) => b.value - a.value);
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(normalize(r.name)) && seen.add(normalize(r.name)));
}

async function buildPuzzle(topic: Topic): Promise<Puzzle> {
  const rows = (await readRows(topic)).slice(0, 10 + EXTRAS);
  if (rows.length < 10) throw new Error(`only ${rows.length} rows`);
  if (rows.length > 10 && rows[9].value === rows[10].value) {
    throw new Error(`tie at #10/#11: ${rows[9].name} / ${rows[10].name}`);
  }

  const entries: Entry[] = [];
  for (const [i, row] of rows.entries()) {
    const aliases = new Set(row.aliasSeeds);
    if (i < 10) for (const r of await fetchRedirects(row.redirectTarget)) aliases.add(r);
    if (topic.people) {
      const last = row.name.split(" ").at(-1)!;
      if (last.length >= 4) aliases.add(last);
    }
    entries.push({
      rank: i + 1,
      name: row.name,
      aliases: [...aliases],
      value: row.valueText + (topic.unit ?? ""),
    });
  }

  // Drop aliases that point at more than one entry, and dedupe by normalized form.
  const owners = new Map<string, Set<number>>();
  for (const e of entries) {
    for (const form of [e.name, ...e.aliases]) {
      const n = normalize(form);
      if (!owners.has(n)) owners.set(n, new Set());
      owners.get(n)!.add(e.rank);
    }
  }
  for (const e of entries) {
    const kept = new Map<string, string>();
    const own = normalize(e.name);
    for (const a of e.aliases) {
      const n = normalize(a);
      if (n && n !== own && !kept.has(n) && owners.get(n)!.size === 1) kept.set(n, a);
    }
    e.aliases = [...kept.values()];
  }

  return {
    id: topic.id,
    title: topic.title,
    prompt: topic.prompt,
    metric: topic.metric,
    source: { name: `Wikipedia: ${topic.page}`, url: pageUrl(topic.page), asOf: new Date().toISOString().slice(0, 10) },
    answers: entries.slice(0, 10),
    extras: entries.slice(10),
  };
}

const only = process.argv.slice(2);
mkdirSync(OUT_DIR, { recursive: true });
const index: { id: string; title: string; category: string }[] = [];
for (const topic of TOPICS) {
  if (only.length && !only.includes(topic.id)) continue;
  try {
    const p = await buildPuzzle(topic);
    writeFileSync(join(OUT_DIR, `${p.id}.json`), JSON.stringify(p));
    index.push({ id: p.id, title: p.title, category: topic.category });
    console.log(`ok   ${p.id.padEnd(24)} ${p.answers.map((a) => a.name).join(", ")}`);
  } catch (err) {
    console.log(`FAIL ${topic.id.padEnd(24)} ${(err as Error).message}`);
  }
}
if (!only.length) writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(index, null, 1));
