import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

export interface Cell {
  text: string;
  /** Title of the first article link in the cell, if any. */
  link?: string;
  /** Visible text of that link. */
  linkText?: string;
  isHeader: boolean;
}

export function cleanText(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readCell($: CheerioAPI, el: Element): Cell {
  const $el = $(el).clone();
  $el.find("sup, .reference, style, .sortkey, [style*='display:none']").remove();
  const a = $el
    .find("a[href*='/wiki/'][title]")
    .filter((_, x) => !$(x).find("img").length && !/^(File|Help|Wikipedia|Template):/.test($(x).attr("title") ?? ""))
    .first();
  return {
    text: cleanText($el.text()),
    link: a.attr("title"),
    linkText: a.length ? cleanText(a.text()) : undefined,
    isHeader: el.tagName === "th",
  };
}

/** Expand a table into a rectangular grid, resolving rowspan/colspan. */
export function tableGrid($: CheerioAPI, table: Element): Cell[][] {
  const grid: Cell[][] = [];
  const rows = $(table).children("tbody, thead").children("tr").toArray();
  rows.forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const el of $(tr).children("th, td").toArray() as Element[]) {
      while (grid[r][c]) c++;
      const cell = readCell($, el);
      const rs = Math.min(parseInt($(el).attr("rowspan") ?? "1") || 1, rows.length - r);
      const cs = parseInt($(el).attr("colspan") ?? "1") || 1;
      for (let dr = 0; dr < rs; dr++) {
        grid[r + dr] ??= [];
        for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = cell;
      }
      c += cs;
    }
  });
  return grid;
}

export function wikitables($: CheerioAPI): Element[] {
  return $("table.wikitable").toArray() as Element[];
}

/** Header rows are the leading rows made only of <th>. */
export function splitHeader(grid: Cell[][]): { header: string[]; body: Cell[][] } {
  let i = 0;
  while (i < grid.length && grid[i].every((c) => c?.isHeader)) i++;
  const width = Math.max(...grid.map((r) => r.length));
  const header = Array.from({ length: width }, (_, c) =>
    [...new Set(grid.slice(0, i).map((r) => r[c]?.text ?? ""))].filter(Boolean).join(" / "),
  );
  return { header, body: grid.slice(i) };
}
