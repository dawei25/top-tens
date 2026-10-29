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
    if (/[:/#]/.test(t) || JUNK_REDIRECT.test(t)) return;
    t = t.replace(/\s*\(.*?\)\s*/g, " ").trim();
    if (!t || t.split(/\s+/).length > 6) return;
    out.add(t);
  });
  return [...out];
}
