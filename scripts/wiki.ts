import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as cheerio from "cheerio";

const CACHE_DIR = join(import.meta.dirname, "..", ".cache", "wiki");
const USER_AGENT = "TopTensPuzzleBuilder/0.1 (hobby trivia game)";
const MIN_GAP_MS = 1500;

let lastRequest = 0;

export class NotFound extends Error {}

async function fetchCached(url: string, cacheOnly = false): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".html");
  if (existsSync(file)) return readFileSync(file, "utf8");
  if (cacheOnly) throw new NotFound(url);

  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      const body = await res.text();
      writeFileSync(file, body);
      return body;
    }
    if (res.status === 404) throw new NotFound(url);
    if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error(`gave up on ${url}`);
}

export function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

export async function fetchPage(title: string): Promise<cheerio.CheerioAPI> {
  return cheerio.load(await fetchCached(pageUrl(title)));
}

const JUNK_REDIRECT =
  /^(the )?(\w+ )?(etymology|history|economy|gdp|politics|political system|culture|society|geography|demographics|population|list|outline|names?|flag|government|wildlife|biodiversity|environment|pollution|infrastructure|administrative divisions?|subdivisions?|tourism|transport|education|health|religion|military|cuisine|music|sports?|media|climate|information)\b.*\b(of|in)\b/i;

/** Redirects about an aspect of the thing rather than naming it: "Personal life of X", "X–Y rivalry". */
const ASPECT_REDIRECT = new RegExp(
  [
    "^(personal|early|private|later|political|professional|sporting|playing|coaching|business|musical|acting) (life|career)\\b",
    "^(controversies surrounding|life|career|death|legacy|reception|assassination|presidency|criticism|biography|works|awards|honours|honors|controversies|influence|impact|image|depictions?|ecology|geology|flora|fauna|conservation|railways|railroads|protected areas|natural resources|environmental issues|social issues|indigenous peoples|human rights|lgbt rights|public image|cultural depictions)\\b.*\\b(of|in)\\b",
    "\\b(rivalry|discography|filmography|bibliography|videography|awards|honours|honors|controversies|controversy|statistics|records|career|nicknames?|in popular culture|in fiction|in film|in world war i+|during world war i+|trivia)$",
    "\\(disambiguation\\)",
  ].join("|"),
  "i",
);

/**
 * Redirect titles pointing at an article; used as answer aliases.
 * With cacheOnly, returns only what an earlier build already fetched (used for ranks 11+, to stay polite).
 */
export async function fetchRedirects(title: string, cacheOnly = false): Promise<string[]> {
  const url =
    "https://en.wikipedia.org/w/index.php?title=Special:WhatLinksHere/" +
    encodeURIComponent(title.replace(/ /g, "_")) +
    "&hidelinks=1&hidetrans=1&limit=500";
  let html: string;
  try {
    html = await fetchCached(url, cacheOnly);
  } catch (e) {
    if (e instanceof NotFound) return [];
    throw e;
  }
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("#mw-whatlinkshere-list > li").each((_, li) => {
    let t = $(li).find("bdi > a").first().attr("title") ?? "";
    if (/[:/#]/.test(t) || JUNK_REDIRECT.test(t) || ASPECT_REDIRECT.test(t)) return;
    t = t.replace(/\s*\(.*?\)\s*/g, " ").trim();
    if (!t || t.split(/\s+/).length > 6) return;
    out.add(t);
  });
  return [...out];
}

/**
 * Article titles in a category and its subcategories down to `depth` levels, for widening answer pools.
 * Reads the normal category pages (200 titles each, following "next page" links) through the same cached,
 * throttled fetcher. Stops at `cap` titles.
 */
export async function fetchCategory(name: string, depth = 1, cap = 3000): Promise<string[]> {
  const titles = new Set<string>();
  const seen = new Set<string>();
  const queue: [string, number][] = [[name.replace(/^Category:/, ""), 0]];
  while (queue.length && titles.size < cap) {
    const [cat, level] = queue.shift()!;
    if (seen.has(cat)) continue;
    seen.add(cat);
    let url: string | undefined = pageUrl(`Category:${cat}`);
    let first = true;
    while (url && titles.size < cap) {
      let html: string;
      try {
        html = await fetchCached(url);
      } catch (e) {
        if (e instanceof NotFound) break;
        throw e;
      }
      const $ = cheerio.load(html);
      $("#mw-pages .mw-category a[title]").each((_, a) => {
        if (titles.size < cap) titles.add($(a).attr("title")!);
      });
      if (first && level < depth) {
        $("#mw-subcategories a[title^='Category:']").each((_, a) => {
          queue.push([$(a).attr("title")!.replace(/^Category:/, ""), level + 1]);
        });
      }
      first = false;
      const next = $("#mw-pages a")
        .filter((_, a) => $(a).text().trim() === "next page")
        .first()
        .attr("href");
      url = next ? new URL(next, "https://en.wikipedia.org").toString() : undefined;
    }
  }
  return [...titles];
}
