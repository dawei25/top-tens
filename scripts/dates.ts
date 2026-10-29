import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { cleanText } from "./table";

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
/** "as of 1 July 2025", "as of September 2026", "As of 2025". */
const AS_OF = new RegExp(`\\bas of\\s+((?:\\d{1,2}\\s+)?(?:${MONTH}\\.?\\s+)?(?:\\d{1,2},?\\s+)?(?:19|20)\\d{2})`, "i");
/** "(March 2026)", "September 2026". */
const MONTH_YEAR = new RegExp(`\\b(${MONTH}\\.?\\s+(?:\\d{1,2},?\\s+)?(?:19|20)\\d{2})`, "i");
/** A year, even glued to a word ("2025estimate", "2020Census"). */
const YEAR = /(?<!\d)((?:19|20)\d{2})(?!\d)/;
/** A bare year in a caption is often history ("since 1966"); only recent ones read as a data date. */
const RECENT = 2015;

/** Text near a table that describes it: its caption, then up to two paragraphs right before it. */
function tableContext($: CheerioAPI, table: Element): string[] {
  const out = [cleanText($(table).find("caption").first().text())];
  let el = $(table).prev();
  for (let i = 0; i < 4 && el.length && out.length < 3; i++, el = el.prev()) {
    if (el.is("p")) out.push(cleanText(el.text()));
    if (el.is("h2, h3, .mw-heading")) break;
  }
  return out.filter(Boolean);
}

/**
 * When the table's numbers are from, if the page says: an "as of" date in the caption or the paragraphs before
 * the table, a month and year in the caption, or a year in the value column's header ("2025 estimate", "IMF (2026)").
 * Undefined when nothing is stated.
 */
export function tableDataDate($: CheerioAPI, table: Element, valueHeader: string): string | undefined {
  const context = tableContext($, table);
  for (const text of context) {
    const m = text.match(AS_OF);
    if (m) return tidy(m[1]);
  }
  const caption = context[0] ?? "";
  const my = caption.match(MONTH_YEAR);
  if (my) return tidy(my[1]);
  const hy = valueHeader.match(YEAR);
  if (hy) return hy[1];
  const cy = caption.match(YEAR);
  if (cy && Number(cy[1]) >= RECENT) return cy[1];
  return undefined;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/,$/, "").trim();
}
