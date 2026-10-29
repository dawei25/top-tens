// Values for unranked answers, read from each article's infobox (table.infobox).
// Only for lists where the infobox number means the same as the list's metric; see `values` in topics.ts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheerioAPI } from "cheerio";
import type { Entry } from "../src/game/types";
import { cleanText, statNumber } from "./table";
import { normalize } from "../src/game/match";
import { NO_VALUE, pickLikely } from "./likely";
import type { Topic } from "./topics";
import { fetchPage, NotFound } from "./wiki";

export type ValueKind = "elevation" | "area" | "nba-points" | "subscribers" | "passengers";

export interface Reading {
  /** The number as shown, without the topic's unit: "4,478", "27.5 million". */
  display?: string;
  /** The year the infobox gives for a number that changes (subscribers, passengers). */
  year?: string;
  /** The number in the list's own unit (topic scale), for sanity checks against the ranked rows. */
  number?: number;
  /** The infobox text the number came from, for review. */
  raw?: string;
  /** Why no value was taken. */
  skip?: string;
}

interface Row {
  /** Nearest header row above ("Highest point", "Career NBA statistics", "Statistics (2024)"). */
  header: string;
  label: string;
  data: string;
}

/** The first infobox's rows as header / label / data text, footnotes and hidden sort keys removed. */
export function infoboxRows($: CheerioAPI): Row[] | null {
  const box = $("table.infobox").first();
  if (!box.length) return null;
  const rows: Row[] = [];
  let header = "";
  box.find("tr").each((_, tr) => {
    const $tr = $(tr).clone();
    // Footnotes go, but not every <sup>: "km<sup>2</sup>".
    $tr.find("sup.reference, sup.noprint, .reference, style, .sortkey, [style*='display:none']").remove();
    const th = $tr.children("th");
    const td = $tr.children("td");
    if (th.length && !td.length) {
      header = cleanText(th.text());
      return;
    }
    // Full-width rows ("Last updated: ...") have no label.
    rows.push({ header, label: th.length ? cleanText(th.first().text()) : "", data: cleanText(td.first().text()) });
  });
  return rows;
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?`;

/** Distinct numbers followed by `unit` in a text. */
function numbersWith(text: string, unit: string): { text: string; value: number }[] {
  const out = new Map<number, string>();
  for (const m of text.matchAll(new RegExp(NUM + String.raw`\s?(?:` + unit + ")", "g"))) {
    const value = parseFloat((m[1] + (m[2] ?? "")).replace(/,/g, ""));
    if (!out.has(value)) out.set(value, m[1] + (m[2] ?? ""));
  }
  return [...out].map(([value, text]) => ({ value, text }));
}

const withCommas = (n: number) => Math.round(n).toLocaleString("en-US");

function elevation(rows: Row[]): Reading {
  // A mountain range's infobox names its highest peak; its elevation is the peak's, not the range's.
  if (rows.some((r) => /^(peak|highest peak)$/i.test(r.label))) return { skip: "a range (its highest peak's elevation)" };
  const row = rows.find((r) => /^elevation$/i.test(r.label));
  if (!row) return { skip: "no Elevation row" };
  const metres = numbersWith(row.data, String.raw`m\b`);
  if (!metres.length) return { skip: "Elevation has no metres", raw: row.data };
  const rounded = new Set(metres.map((m) => Math.round(m.value)));
  if (rounded.size > 1) return { skip: "several elevations", raw: row.data };
  const n = Math.round(metres[0].value);
  return { display: withCommas(n), number: n, raw: row.data };
}

function area(rows: Row[]): Reading {
  const i = rows.findIndex((r) => /^area$/i.test(r.label) || (/^area$/i.test(r.header) && /^•?\s*total$/i.test(r.label)));
  if (i < 0) return { skip: "no Area row" };
  let row = rows[i];
  // Country and region boxes: an "Area" group of "• Total", "• Land", "• Water (%)" rows. Islands are ranked by
  // land, so take Land when given, and drop a Total that includes much water (lagoons, sea).
  const group: Row[] = [];
  for (const r of rows.slice(i + 1)) {
    if (!/^•/.test(r.label) || r.header !== rows[i].header) break;
    group.push(r);
  }
  const land = group.find((r) => /^•\s*land$/i.test(r.label));
  const water = group.find((r) => /^•\s*water\s*\(%\)$/i.test(r.label));
  const waterPct = water ? parseFloat(water.data.replace(/,/g, "")) : NaN;
  if (land && numbersWith(land.data, "km2|km²").length) row = land;
  else {
    if (!numbersWith(row.data, "km2|km²").length) row = group.find((r) => /^•\s*total$/i.test(r.label)) ?? row;
    if (waterPct > 5) return { skip: `total area includes ${waterPct}% water`, raw: row.data };
  }
  const km = numbersWith(row.data, "km2|km²");
  if (!km.length) return { skip: "Area has no km²", raw: row.data };
  if (km.length > 1) return { skip: "several areas", raw: row.data };
  return { display: km[0].text, number: km[0].value, raw: row.data };
}

function nbaPoints(rows: Row[]): Reading {
  const stats = rows.filter((r) => /^career\b.*\bstatistics$/i.test(r.header));
  if (!stats.length) return { skip: "no career statistics" };
  // "Career ABA and NBA statistics" (or NBL/BAA) adds other leagues' points; the list is NBA only. Plain "Career
  // statistics" is the template's default for an NBA career.
  if (!stats.every((r) => /^career (nba )?(playing )?statistics$/i.test(r.header))) {
    return { skip: `header "${stats[0].header}"` };
  }
  const row = stats.find((r) => /^points$/i.test(r.label));
  if (!row) return { skip: "no Points row" };
  const m = row.data.match(new RegExp("^" + NUM + String.raw`(?!\.)\b`));
  if (!m || m[2]) return { skip: "Points not a whole number", raw: row.data };
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return { display: withCommas(n), number: n, raw: row.data };
}

/** A year in "Last updated: October 1, 2024" style rows. */
function updatedYear(rows: Row[]): string | undefined {
  for (const r of rows) {
    const text = `${r.label} ${r.data}`;
    const m = text.match(/\b(?:last )?updated\b:?.*?\b((?:19|20)\d{2})\b/i);
    if (m) return m[1];
  }
  return undefined;
}

function subscribers(rows: Row[], names: string[]): Reading {
  const subs = rows.filter((r) => /^subscribers$/i.test(r.label));
  if (!subs.length) return { skip: "no Subscribers row" };
  if (subs.length > 1) return { skip: "several channels", raw: subs.map((r) => r.data).join(" / ") };
  const raw = subs[0].data;
  // "18.5 million (main channel) 24.8 million (music channel) 47.49 million (combined)": each count with its label.
  const counts = [
    ...raw.matchAll(new RegExp(NUM + String.raw`\s*(million|thousand|billion)?\s*(?:\(([^)]*)\))?`, "gi")),
  ].filter((m) => !/^(19|20)\d\d$/.test(m[1]) || m[3]);
  if (!counts.length) return { skip: "no number", raw };
  // A combined count adds up several channels; the list ranks single channels. With several counts, take the one
  // labelled as the main channel or with the entry's own name.
  const own = new Set(names.map(normalize));
  const label = (m: RegExpMatchArray) => (m[4] ?? "").trim();
  let pick: RegExpMatchArray | undefined;
  if (counts.length === 1) pick = counts[0];
  else {
    const main = counts.filter((m) => /^main( channel)?$/i.test(label(m)) || own.has(normalize(label(m))));
    if (main.length === 1) pick = main[0];
  }
  if (!pick) return { skip: "several numbers", raw };
  if (/combined/i.test(label(pick))) return { skip: "combined count of several channels", raw };
  const m = pick;
  const digits = m[1] + (m[2] ?? "");
  const word = m[3]?.toLowerCase();
  const value = parseFloat(digits.replace(/,/g, "")) * ({ million: 1e6, thousand: 1e3, billion: 1e9 }[word ?? ""] ?? 1);
  if (!word && !/,/.test(digits)) return { skip: "bare small number", raw };
  const year = updatedYear(rows);
  const channels = rows.find((r) => /^channels?$/i.test(r.label));
  return {
    display: `${digits}${word ? " " + word : ""}`,
    year,
    number: value,
    raw: raw + (year ? ` [updated ${year}]` : "") + (channels ? ` [channels: ${channels.data}]` : ""),
  };
}

function passengers(rows: Row[]): Reading {
  const row = rows.find((r) => /^(total )?passengers(\s*\((19|20)\d{2}\))?$/i.test(r.label));
  if (!row) return { skip: "no Passengers row" };
  const year = (row.label.match(/(19|20)\d{2}/) ?? row.header.match(/^Statistics.*?\b((?:19|20)\d{2})\b/i))?.[0]?.match(/\d{4}/)?.[0];
  const m = row.data.match(new RegExp("^" + NUM + String.raw`\s*(million)?`, "i"));
  if (!m) return { skip: "Passengers has no number", raw: row.data };
  const digits = m[1] + (m[2] ?? "");
  const value = parseFloat(digits.replace(/,/g, "")) * (m[3] ? 1e6 : 1);
  if (value < 1000) return { skip: "implausible passenger count", raw: row.data };
  return {
    display: `${digits}${m[3] ? " million" : ""}`,
    year,
    number: value,
    raw: `${row.header} | ${row.label} | ${row.data}`,
  };
}

/**
 * Reads a value of the given kind from an article; `scale` divides the number into the list's unit. `names` are
 * the entry's own names, for picking its channel out of several.
 */
export function readValue($: CheerioAPI, kind: ValueKind, scale = 1, names: string[] = []): Reading {
  if ($("#disambigbox, .dmbox-disambig").length) return { skip: "disambiguation page" };
  const rows = infoboxRows($);
  if (!rows) return { skip: "no infobox" };
  const read = { elevation, area, "nba-points": nbaPoints, subscribers, passengers }[kind];
  const r = read(rows, names);
  if (r.number !== undefined) r.number /= scale;
  return r;
}

const LIKELY_DIR = join(import.meta.dirname, "unranked");

/**
 * Title qualifiers that only say what kind of thing the article is ("Dom (mountain)", "Ninja (gamer)"), so the
 * plain name means the same thing. Any other qualifier names a place or a namesake.
 */
const KIND_QUALIFIER =
  /^(mountain|volcano|island|islands|archipelago|massif|peak|gamer|youtuber|internet personality|presenter|entertainer|comedian|band|web series|media franchise|basketball|basketball player|.*\bborn \d{4})$/i;

/**
 * Sets `value` on the topic's likeliest unranked entries from their articles' infoboxes, and records every pick
 * (article, why it was picked, the value or why there is none) in scripts/unranked/<id>.json for review.
 * `ranked` is the ranked rows' numbers, best first. Returns [values found, entries tried].
 */
export async function addValues(
  topic: Topic,
  entries: Entry[],
  articleOf: (e: Entry) => string,
  ranked: number[],
): Promise<[number, number]> {
  const { kind, scale = 1, below = "tenth" } = topic.values!;
  const limit = below === "last" ? ranked.at(-1)! : ranked[Math.min(9, ranked.length - 1)];
  const picks = await pickLikely(topic.id, entries, articleOf);
  const lines: string[] = [];
  let found = 0;
  for (const { entry, why } of picks) {
    const article = articleOf(entry);
    const qualifier = article.match(/\(([^)]*)\)$/)?.[1];
    let r: Reading;
    if (NO_VALUE[topic.id]?.[entry.name]) r = { skip: NO_VALUE[topic.id][entry.name] };
    else if (qualifier && !entry.name.includes("(") && !KIND_QUALIFIER.test(qualifier)) {
      // "Channel Islands (California)": a player typing the plain name means the better-known namesake.
      r = { skip: `article is the "${qualifier}" one; the plain name usually means a better-known namesake` };
    } else {
      try {
        r = readValue(await fetchPage(article), kind, scale, [entry.name, article, ...entry.aliases]);
      } catch (e) {
        if (!(e instanceof NotFound)) throw e;
        r = { skip: "no article" };
      }
    }
    // At or above the cutoff it would be ranked: the infobox measures something else (ABA points, a group).
    if (r.number !== undefined && !(r.number < limit)) {
      r = { skip: `${r.display} is not below the ${below === "last" ? "last ranked" : "#10"} value`, raw: r.raw };
    }
    const value = r.display
      ? (topic.prefix ?? "") + r.display + (topic.unit ?? "") + (r.year ? ` (${r.year})` : "")
      : undefined;
    if (value) {
      entry.value = value;
      // Already in the list's unit (scale applied); the year in "(2025)" is never part of it.
      if (r.number !== undefined && Number.isFinite(r.number)) entry.n = statNumber(r.number);
      found++;
    }
    const rec = {
      article,
      why,
      ...(value ? { value, ...(entry.n !== undefined ? { n: entry.n } : {}) } : { skip: r.skip }),
      ...(r.raw ? { raw: r.raw } : {}),
    };
    lines.push(`  ${JSON.stringify(entry.name)}: ${JSON.stringify(rec)}`);
  }
  writeFileSync(join(LIKELY_DIR, `${topic.id}.json`), `{\n${lines.join(",\n")}\n}\n`);
  return [found, picks.length];
}
