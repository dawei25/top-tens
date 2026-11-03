// Checks every built puzzle in public/puzzles for likely data problems.
// Usage: NODE_NO_WARNINGS=1 npx tsx scripts/validate.ts
// Exits 1 if any hard error is found; warnings are printed but don't fail.
import { TEST_SET } from "./topics";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/game/match";
import type { Entry, Puzzle } from "../src/game/types";
import { CITY_FORMS, COUNTRY_FORMS, INTENT, NICKNAMES, STATE_FORMS } from "./intent";

/** Curated forms shared by many lists (countries, cities, states, athletes' nicknames). */
const SHARED_FORMS = [
  ...COUNTRY_FORMS.flat(),
  ...CITY_FORMS.flat(),
  ...Object.values(NICKNAMES).flat(),
  ...Object.values(STATE_FORMS).flat(),
  "Congo",
  "Congolese",
];
import { bareWord, blockedAlias, gluedAlias, junkRedirect, placeholderName } from "./aliases";
import { citysCountries, countryOf, isContinent, MAJOR_CITIES, UNIVERSES, whereIs, type Where } from "./gazetteer";
import { NOT_PUZZLES } from "./lexicon";
import { TOPICS, type Topic } from "./topics";

const DIR = join(import.meta.dirname, "..", "public", "puzzles");
const FACTS_DIR = join(import.meta.dirname, "facts");
/** Neighbours in a ranking more than this far apart (ratio of their numbers) get a second look. */
const JUMP = 20;
/** Country, state and capital names. */
const PLACES = new Set(
  [...UNIVERSES.countries(), ...UNIVERSES["us-states"](), ...UNIVERSES.capitals()].map((c) => normalize(c.name)),
);
/** Lists of places, where a place name alias is expected. */
const isPlaceList = (p: Puzzle) => {
  const t = TOPICS.find((x) => x.id === p.id);
  return !!t?.universe || /cities|capitals|countries|population|states|metros|islands/.test(p.id);
};
const topicNoun = (id: string) => TOPICS.find((t) => t.id === id)?.noun;
/** The fields of an entry in the puzzle format (src/game/types.ts `Entry`). */
const ENTRY_FIELDS = new Set(["rank", "name", "aliases", "value", "n", "article", "fact", "elsewhere"]);
/** Below this many accepted answers, wrong-but-real guesses are likely to be free. */
const MIN_ACCEPTED = 30;
/**
 * Lists built (source.asOf) on or after this day must have a fact on every top-10 answer; older builds only warn.
 * A rebuild brings a list under the rule.
 */
export const FACTS_REQUIRED_FROM = "2026-11-02";
/** A ranking this short leaves most misses unranked: they need a figure from somewhere, or a reason (`noFigures`). */
export const SHORT_RANKING = 25;

type Level = "error" | "warn";
export interface Issue {
  level: Level;
  msg: string;
}

/**
 * How many answers the source ranks, and how many of the rest (rank 0) show a figure when missed. Places outside a
 * regional list's region aren't counted: their miss says so instead.
 */
export function figureShare(p: Pick<Puzzle, "answers" | "extras">): { ranked: number; unranked: number; withValue: number } {
  const unranked = p.extras.filter((e) => e.rank === 0 && !e.elsewhere);
  return {
    ranked: [...p.answers, ...p.extras].filter((e) => e.rank > 0).length,
    unranked: unranked.length,
    withValue: unranked.filter((e) => e.value?.trim()).length,
  };
}

/** Problems with one fact: an em dash, no text, no source URL. */
export function factIssues(where: string, fact: { text?: string; source?: string }): string[] {
  const out: string[] = [];
  if (!fact.text?.trim()) out.push(`${where}: fact has no text`);
  if (fact.text?.includes("—")) out.push(`${where}: fact has an em dash`);
  if (!/^https?:\/\/\S+$/.test(fact.source ?? "")) out.push(`${where}: fact has no source URL`);
  return out;
}

/**
 * Why a name looks like table debris rather than an answer, or null if it looks fine. `numbers`: names can be
 * numbers on this list ("123456" on passwords).
 */
export function junkReason(name: string, numbers = false): string | null {
  if (/\[\s*\w{0,8}\s*\]/.test(name)) return "footnote marker";
  if (/^(list|lists|table) of\b/i.test(name)) return 'starts with "List of"';
  if (/^(grand )?(totals?|subtotal|overall|world|others?|various|unknown|n\/a|rest of( the)? world)$/i.test(name.trim())) {
    return "total/placeholder row";
  }
  // Titles can be numbers ("1989", "21", "2012"); table debris looks like "1,286" or a long serial.
  if (/\d{6,}/.test(name) && !numbers) return "long digit run";
  if (/^[\d\s.,%$€£()+-]+$/.test(name) && (/,\d{3}/.test(name) || (/\d{5,}/.test(name) && !numbers))) return "a number, not a name";
  if (/\b(citation needed|ref\.)|^(notes?|see also)$/i.test(name)) return "note text";
  if (name.length > 80) return "very long";
  if (/^[^\p{L}\p{N}"'¡¿(.&+]/u.test(name)) return "starts with punctuation";
  return null;
}

/** "Djibouti City", "City of San Marino": the words that make a city's name without changing which city. */
const cityless = (s: string) => s.split(" ").filter((w) => !/^(city|of|town)$/.test(w)).join(" ");

/**
 * Ranked entries that an unranked universe member may duplicate under another name: "Republic of the Congo" and a
 * ranked "Congo", "South Tarawa" and "Tarawa", "Djibouti" and "Djibouti City". Each pair is one answer (a player
 * could lose two lives on it, the second with no figure): give the ranked row the member's name as an alias
 * (`aliases` in topics.ts) and the member merges into it. Other spellings ("Ulan Bator") need a look by eye.
 */
export function sameAsUniverse(p: Pick<Puzzle, "answers" | "extras">, topic?: Pick<Topic, "universe">): string[] {
  const universes = [topic?.universe ?? []].flat();
  if (!universes.length) return [];
  const members = new Set(universes.flatMap((u) => UNIVERSES[u]().map((m) => normalize(m.name))));
  const all = [...p.answers, ...p.extras];
  // A place outside a regional list's region is another place by definition.
  const pool = all.filter((e) => e.rank === 0 && !e.elsewhere && members.has(normalize(e.name)));
  const out: string[] = [];
  for (const e of all) {
    const n = normalize(e.name);
    if (e.rank === 0 || members.has(n)) continue;
    const same = pool.find((m) => ` ${normalize(m.name)} `.includes(` ${n} `) || cityless(normalize(m.name)) === cityless(n));
    if (same) out.push(`#${e.rank} "${e.name}" and unranked "${same.name}" may be the same answer`);
  }
  return out;
}

/**
 * Teams of a team universe the list can't take by nickname: every member's other names ("Cubs", "Nats") must be
 * names of the entry that is that team, ranked or not (judge, cycle 6: the teams in the source table had none).
 * A nickname another member owns ("Giants" on NFL and MLB lists is one team each) is that member's.
 */
export function missingNicknames(p: Pick<Puzzle, "answers" | "extras">, topic?: Pick<Topic, "universe" | "skip">): string[] {
  const out: string[] = [];
  const all = [...p.answers, ...p.extras];
  for (const u of [topic?.universe ?? []].flat().filter((u) => /-teams$/.test(u))) {
    for (const m of UNIVERSES[u]()) {
      if (topic?.skip?.includes(m.name)) continue;
      const e = all.find((x) => normalize(x.name) === normalize(m.name)) ?? all.find((x) => x.aliases.some((a) => normalize(a) === normalize(m.name)));
      if (!e) {
        out.push(`${m.name} (${u}) is no answer`);
        continue;
      }
      const forms = new Set([e.name, ...e.aliases].map(normalize));
      for (const a of m.aliases) if (!forms.has(normalize(a))) out.push(`${e.rank ? `#${e.rank} ` : ""}${e.name}: no "${a}"`);
    }
  }
  return out;
}

/** Continents a title or prompt can name. */
const CONTINENT_WORDS =
  /\b(Africa|African|Asia|Asian|Europe|European|North America|North American|South America|South American|Latin America|Latin American|Oceania)\b/;
const PLACE_NOUN = /\b(countries|cities|capitals)\b/;

/**
 * The continent or country a list of places names in its title or prompt ("Most populous African countries",
 * "Largest cities in mainland China") when it adds answers beyond its own table (a universe of countries or
 * capitals, another page's table) and declares no `region`: the world would get in ("Japan" on European
 * countries, cycle 7). Undefined when there is nothing to declare.
 */
export function undeclaredRegion(topic?: Pick<Topic, "title" | "prompt" | "noun" | "page" | "region" | "universe" | "universeNamesOnly" | "also">): string | undefined {
  if (!topic || topic.region || !PLACE_NOUN.test(topic.noun)) return undefined;
  const world = !topic.universeNamesOnly && [topic.universe ?? []].flat().some((u) => u === "countries" || u === "capitals");
  const others = (topic.also ?? []).some((a) => a.page && a.page !== topic.page);
  if (!world && !others) return undefined;
  const continent = `${topic.title} ${topic.prompt}`.match(CONTINENT_WORDS)?.[0];
  if (continent) return continent;
  // A country by name in the title: "US", "mainland China", "United Kingdom" (capitalized words, up to three).
  const words = topic.title.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const gram = words.slice(i, i + n);
      if (gram.every((w) => /^\p{Lu}/u.test(w)) && countryOf(gram.join(" "))) return gram.join(" ");
    }
  }
  return undefined;
}

/**
 * Regional lists built on or after this day say their region and mark the places outside it (`elsewhere`); older
 * builds (europe-population's, patched by hand) only warn until they are rebuilt.
 */
export const REGION_REQUIRED_FROM = "2026-11-03";

type RegionalTopic = Pick<Topic, "region" | "noun" | "skip">;
const isCityList = (p: Pick<Puzzle, "noun">, topic?: Pick<Topic, "noun">) => /\b(cities|capitals)\b/.test(topic?.noun ?? p.noun ?? "");

/**
 * Where the gazetteer puts an entry of a regional list: its countries (a country list's entry is one; a city is its
 * country's capital, one of the world's largest cities, or a city-state) and, over them, "inside" if any is in the
 * region, "unsure" if any may be (a transcontinental country), else "outside". Undefined for a place it doesn't know.
 */
function placeOf(e: Entry, region: string, cities: boolean): { countries: string[]; where: Where } | undefined {
  const named = cities ? [...citysCountries(e.name), countryOf(e.name)?.name] : [[e.name, ...e.aliases].map((f) => countryOf(f)).find(Boolean)?.name];
  const countries = [...new Set(named.filter((c): c is string => !!c))];
  if (!countries.length) return undefined;
  const wheres = countries.map((c) => whereIs(c, region));
  const where = wheres.includes("inside") ? "inside" : wheres.includes("unsure") ? "unsure" : "outside";
  return { countries, where };
}

/** "Japan" (Asia) on a country list, "Tokyo" (Japan) on a city list. */
const placeLabel = (e: Entry, countries: string[], cities: boolean) =>
  `"${e.name}" (${cities ? countries.join(" or ") : countryOf(countries[0])!.continents.join(" or ")})`;

/**
 * `elsewhere` entries that break the format, whenever the list was built: one off a regional list, one ranked or
 * with a figure, or one the gazetteer puts inside the region (or on its debatable edge: Egypt on Asia stays free).
 */
export function elsewhereErrors(p: Pick<Puzzle, "answers" | "extras" | "noun" | "region">, topic?: RegionalTopic): string[] {
  const out: string[] = [];
  const all = [...p.answers, ...p.extras];
  if (!topic?.region) {
    if (p.region) out.push(`region "${p.region}" on a list whose topic has none`);
    const marked = all.filter((e) => e.elsewhere);
    if (marked.length) out.push(`${marked.length} entries marked elsewhere on a list with no region, e.g. "${marked[0].name}"`);
    return out;
  }
  const cities = isCityList(p, topic);
  for (const e of all.filter((x) => x.elsewhere)) {
    if (e.rank !== 0 || e.value !== undefined || e.n !== undefined) out.push(`"${e.name}" is marked elsewhere but has a rank or a figure`);
    const place = placeOf(e, topic.region, cities);
    if (place && place.where !== "outside") {
      out.push(`"${e.name}" is marked elsewhere but is ${place.where === "inside" ? "in" : "maybe in"} ${topic.region} (${place.countries.join(" or ")})`);
    }
  }
  return out;
}

/**
 * What a regional list built from REGION_REQUIRED_FROM must have: its region said on the puzzle, every unranked
 * place outside the region marked `elsewhere` (so "Japan" costs a life and says "Japan isn't in Europe.", not
 * "outside the top 55"), and, on a country list, every country plainly outside the region present (a transcontinental
 * one reaching it stays free); on a city list, the world's largest cities outside it. A city with a figure came from
 * the list's own regional tables, so it is that region's namesake: Plymouth, England, not Montserrat's capital.
 */
export function regionGaps(p: Pick<Puzzle, "answers" | "extras" | "noun" | "region">, topic?: RegionalTopic): string[] {
  const region = topic?.region;
  if (!region) return [];
  const out: string[] = [];
  if (p.region !== region) out.push(`the puzzle says region ${p.region ? `"${p.region}"` : "nothing"}, the topic "${region}"`);
  const cities = isCityList(p, topic);
  const all = [...p.answers, ...p.extras];
  const unmarked = all
    .filter((e) => e.rank === 0 && !e.elsewhere && !(cities && e.value))
    .flatMap((e) => {
      const place = placeOf(e, region, cities);
      return place?.where === "outside" ? [placeLabel(e, place.countries, cities)] : [];
    });
  if (unmarked.length) out.push(`${unmarked.length} unranked place(s) outside ${region} not marked elsewhere: ${unmarked.slice(0, 5).join(", ")}`);
  const names = new Set(all.flatMap((e) => [e.name, ...e.aliases]).map(normalize));
  const expected = cities
    ? MAJOR_CITIES.filter(([, country]) => whereIs(country, region) === "outside").map(([city]) => city)
    : UNIVERSES.countries()
        .filter((c) => whereIs(c.name, region) === "outside" && !topic.skip?.includes(c.name))
        .map((c) => c.name);
  const missing = expected.filter((n) => !names.has(normalize(n)));
  if (missing.length) out.push(`${missing.length} place(s) outside ${region} missing, so free instead of elsewhere: ${missing.slice(0, 5).join(", ")}`);
  return out;
}

export function checkPuzzle(p: Puzzle, file: string, topic: Topic | undefined = TOPICS.find((t) => t.id === p.id)): Issue[] {
  const issues: Issue[] = [];
  const err = (msg: string) => issues.push({ level: "error", msg });
  const warn = (msg: string) => issues.push({ level: "warn", msg });

  if (p.id + ".json" !== file) err(`id "${p.id}" doesn't match file name`);
  for (const k of ["title", "prompt", "noun"] as const) if (!p[k]?.trim()) err(`missing ${k}`);
  for (const k of ["title", "prompt", "noun"] as const) if (p[k]?.includes("—")) err(`${k} has an em dash`);
  if (p.prompt && !p.prompt.startsWith("Name the 10 ")) warn(`prompt doesn't start "Name the 10": ${p.prompt}`);
  // Plural and lower case except proper nouns: "countries", "NBA players", "YouTube channels".
  const first = p.noun?.split(" ")[0] ?? "";
  if (/^[A-Z][a-z]+$/.test(first) && !/^(Broadway|Instagram|Facebook|Netflix|Pixar)$/.test(first)) warn(`noun "${p.noun}" starts with a capital`);
  if (p.noun && !/(s|people)$/.test(p.noun)) warn(`noun "${p.noun}" doesn't look plural`);
  if (topicNoun(p.id) && p.noun !== topicNoun(p.id)) err(`noun "${p.noun}" differs from topics.ts`);
  if (!p.source?.url || !p.source?.asOf) err("missing source url or asOf");
  if (p.answers.length !== 10) err(`${p.answers.length} answers, expected 10`);

  p.answers.forEach((e, i) => {
    if (e.rank !== i + 1) err(`answer #${i + 1} has rank ${e.rank}`);
    if (!e.value?.trim()) err(`#${e.rank} ${e.name}: missing value`);
    if (!e.aliases.length) warn(`#${e.rank} ${e.name}: no aliases`);
  });

  // Every top-10 answer has a fact (scripts/facts/<id>.json, matched by name, article or alias), sourced, plain.
  const noFact = p.answers.filter((e) => !e.fact).map((e) => `#${e.rank} ${e.name}`);
  if (noFact.length) {
    const required = (p.source?.asOf ?? "") >= FACTS_REQUIRED_FROM;
    (required ? err : warn)(`${noFact.length} top-10 answer(s) without a fact: ${noFact.join(", ")}`);
  }
  for (const e of [...p.answers, ...p.extras]) if (e.fact) for (const m of factIssues(`#${e.rank} ${e.name}`, e.fact)) err(m);

  // A short ranking: most real guesses are unranked, and a miss with no figure tells the player nothing.
  const share = figureShare(p);
  if (share.ranked <= SHORT_RANKING && share.unranked && !share.withValue && !topic?.noFigures) {
    err(
      `the ranking stops at ${share.ranked} and none of its ${share.unranked} unranked answers has a figure, so misses ` +
        "show none: fill them from the page's other tables (`also` with `dated`) or say why not (`noFigures`)",
    );
  }

  const all: Entry[] = [...p.answers, ...p.extras];
  // A list whose other real names are free on purpose (`knownOnly`: no figure to show) is small by design.
  if (all.length < MIN_ACCEPTED && !topic?.knownOnly) warn(`only ${all.length} accepted answers (want ${MIN_ACCEPTED}+)`);

  // Ranks 11+ follow their place in the ranking; a tie shares the first one's rank (#20, #20, #22).
  let place = 10;
  let last: Entry | undefined;
  for (const e of p.extras) {
    if (e.rank === 0) continue;
    place++;
    const tie = !!last && e.rank === last.rank && e.n !== undefined && e.n === last.n;
    if (e.rank !== place && !tie) err(`extras rank jumps from ${last?.rank ?? 10} to ${e.rank} (${e.name})`);
    last = e;
  }

  const byName = new Map<string, Entry>();
  const numbers = !!topic?.numberNames;
  for (const e of all) {
    const where = e.rank ? `#${e.rank}` : "unranked";
    const why = junkReason(e.name, numbers);
    if (why) (e.rank >= 1 && e.rank <= 10 ? err : warn)(`${where} "${e.name}": looks like junk (${why})`);
    // A title not announced yet is never an answer: "peaky blinders" cost a life as "Untitled Peaky Blinders sequel series".
    if (placeholderName(e.name)) err(`${where} "${e.name}": a placeholder, not a title`);
    const n = normalize(e.name);
    if (!n) err(`${where} "${e.name}": normalizes to nothing`);
    const prev = byName.get(n);
    if (prev) err(`duplicate entry "${e.name}" (#${prev.rank || "-"} and #${e.rank || "-"})`);
    else byName.set(n, e);
    for (const a of e.aliases) {
      const na = normalize(a);
      if (na.replace(/[^a-z0-9]/g, "").length < 2) err(`${where} "${e.name}": alias "${a}" shorter than 2 letters`);
    }
  }

  // Shared aliases are groups ("Did you mean A or B?"); a big group means the alias is too generic.
  const owners = new Map<string, number>();
  for (const e of all) for (const a of new Set(e.aliases.map(normalize))) owners.set(a, (owners.get(a) ?? 0) + 1);
  for (const [a, n] of owners) if (n > 4) warn(`alias "${a}" is shared by ${n} entries`);

  // An alias equal to another entry's name shadows that entry, unless intent.ts made it a group on purpose.
  const curatedGroups = new Set(Object.keys(INTENT[p.id]?.groups ?? {}).map(normalize));
  for (const e of all) {
    for (const a of e.aliases) {
      const other = byName.get(normalize(a));
      if (other && other !== e && !curatedGroups.has(normalize(a))) {
        err(`alias "${a}" of "${e.name}" is the name of "${other.name}"`);
      }
    }
  }

  const built = p as Puzzle & { category?: string };
  if (!built.category) err("missing category");
  else if (topic && built.category !== topic.category) err(`category "${built.category}" differs from topics.ts ("${topic.category}")`);

  // Alias hygiene (scripts/aliases.ts): glued names are broken data; the rest are likely redirects that aren't names.
  const curated = new Set(
    [
      ...Object.values(INTENT[p.id]?.same ?? {}).flat(),
      ...Object.keys(INTENT[p.id]?.groups ?? {}),
      ...Object.values(topic?.aliases ?? {}).flat(),
      ...Object.values(topic?.cited ?? {}).flatMap((c) => c.aliases),
      ...SHARED_FORMS,
    ].map(normalize),
  );
  const junk: string[] = [];
  for (const e of all) {
    const forms = [e.name, ...e.aliases];
    for (const a of e.aliases) {
      if (gluedAlias(a, forms)) warn(`"${e.name}": alias "${a}" looks like several names glued together`);
      if (curated.has(normalize(a))) continue;
      if (blockedAlias(a, [e.name])) err(`"${e.name}": alias "${a}" is a slur or an insult`);
      let why = junkRedirect(a, { names: [e.name], forms, works: topic?.works, webNames: topic?.webNames });
      // "New York City, NY" on New York: the build knew New York City as one of its names; here it is an alias.
      if (why === "a place inside the thing" && forms.some((f) => normalize(f) === normalize(a.split(",")[0]))) why = null;
      if (why) junk.push(`${e.name}: "${a}" (${why})`);
      // A one-word alias that is a plain word or a place, and no word of the name: "City" for Alaska.
      else if (!normalize(e.name).split(" ").includes(normalize(a)) && !isPlaceList(p) && bareWord(a, PLACES)) {
        junk.push(`${e.name}: "${a}" (a plain word or place, not part of the name)`);
      }
    }
  }
  if (junk.length) {
    warn(`${junk.length} alias(es) that look like junk, e.g. ${junk.slice(0, 4).join("; ")}`);
  }

  // Misread numbers: "382.936" among "1,723,337"s is a dot used as a thousands separator.
  const shown = all.filter((e) => e.rank > 0 && e.value).map((e) => [e, e.value!.replace(/^\D+/, "")] as const);
  const grouped = shown.filter(([, v]) => /^\d{1,3}(,\d{3})+/.test(v)).length;
  for (const [e, v] of shown) {
    if (/^\d{1,3}\.\d{3}(?!\d)/.test(v) && grouped > shown.length / 2) {
      err(`#${e.rank} ${e.name}: value "${e.value}" looks misread (a dot as thousands separator)`);
    }
  }
  // One figure without the currency the rest show: "940,300,000" among "$871,014,978"s (an override written out).
  const signed = shown.filter(([e]) => /^[$€£]/.test(e.value!));
  if (signed.length > shown.length / 2) {
    for (const [e] of shown) if (!/^[$€£]/.test(e.value!)) err(`#${e.rank} ${e.name}: value "${e.value}" lacks the currency sign the others show`);
  }
  // A big jump between neighbours in the ranking suggests a misread or mixed units.
  const ranked = all.filter((e) => e.rank > 0 && e.n !== undefined && e.n > 0).sort((a, b) => a.rank - b.rank);
  if (!topic?.lowerIsBetter) {
    for (let i = 1; i < Math.min(ranked.length, 30); i++) {
      const [a, b] = [ranked[i - 1], ranked[i]];
      if (a.n! / b.n! > JUMP) warn(`#${a.rank} ${a.name} (${a.n}) is ${Math.round(a.n! / b.n!)}× #${b.rank} ${b.name} (${b.n}): misread?`);
    }
  }

  // The same place twice: a ranked "Congo" without the aliases of the pool's "Republic of the Congo", the table's
  // Ulaanbaatar next to the capitals universe's "Ulan Bator" (a second life for one city, no figure).
  for (const e of sameAsUniverse(p, topic)) warn(e);
  for (const e of missingNicknames(p, topic)) err(`team nickname: ${e}`);

  // A regional list's places outside its region cost a life and say so: "Japan isn't in Europe." (owner, cycle 7).
  const named = undeclaredRegion(topic);
  if (named) err(`the title names ${named}, but the topic has no \`region\`: its places outside it would pass for answers`);
  if (topic?.region && !isContinent(topic.region) && !countryOf(topic.region)) err(`region "${topic.region}" is no continent or country`);
  for (const m of elsewhereErrors(p, topic)) err(m);
  const regionRequired = (p.source?.asOf ?? "") >= REGION_REQUIRED_FROM;
  for (const m of regionGaps(p, topic)) (regionRequired ? err : warn)(m);
  // Only the puzzle format's fields ship: a build-only field (a capital's `country`) is noise in every download.
  for (const e of all) {
    const extra = Object.keys(e).filter((k) => !ENTRY_FIELDS.has(k));
    if (extra.length) err(`"${e.name}": fields outside the puzzle format: ${extra.join(", ")}`);
  }

  // Blitz scores `n`: it must be present on the top 10, follow the ranking, and share one unit across entries.
  for (const e of all) if (e.n !== undefined && !Number.isFinite(e.n)) err(`"${e.name}": n is not a finite number`);
  if (p.blitz) {
    for (const e of p.answers) if (e.n === undefined) err(`#${e.rank} ${e.name}: blitz list without n`);
    const ranked = all.filter((e) => e.rank > 0 && e.n !== undefined).sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < ranked.length; i++) {
      if (ranked[i].n! > ranked[i - 1].n!) {
        warn(`n rises from #${ranked[i - 1].rank} (${ranked[i - 1].n}) to #${ranked[i].rank} ${ranked[i].name} (${ranked[i].n})`);
      }
    }
    const top = p.answers[0]?.n;
    for (const e of all) {
      if (e.rank === 0 && e.n !== undefined && top !== undefined && e.n > top) {
        warn(`unranked "${e.name}" n ${e.n} exceeds #1's ${top} (unit mismatch?)`);
      }
    }
  }
  return issues;
}

function main(): number {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && !NOT_PUZZLES.has(f));
  const globalIssues: Issue[] = [];

  const indexPath = join(DIR, "index.json");
  const index: { id: string; title: string; category: string }[] = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : [];
  if (!index.length) globalIssues.push({ level: "error", msg: "index.json missing or empty" });
  if (!existsSync(join(DIR, "lexicon.json"))) globalIssues.push({ level: "error", msg: "lexicon.json missing" });
  const indexIds = new Set(index.map((m) => m.id));
  const fileIds = new Set(files.map((f) => f.replace(/\.json$/, "")));
  const topicIds = new Set(TOPICS.map((t) => t.id));
  for (const id of indexIds) if (!fileIds.has(id)) globalIssues.push({ level: "error", msg: `index.json lists "${id}" but there is no ${id}.json` });
  // After `build:test` the index lists only the test set and the scheduled dailies; the other puzzle files are
  // expected to sit unindexed.
  const dailyPath = join(DIR, "daily.json");
  const scheduled = new Set<string>(
    existsSync(dailyPath) ? JSON.parse(readFileSync(dailyPath, "utf8")).map((d: { id: string }) => d.id) : [],
  );
  const testIndex =
    TEST_SET.every((id) => indexIds.has(id)) && [...indexIds].every((id) => TEST_SET.includes(id) || scheduled.has(id));
  if (!testIndex) {
    for (const id of fileIds) if (!indexIds.has(id)) globalIssues.push({ level: "error", msg: `${id}.json is not in index.json` });
  }
  for (const id of fileIds) if (!topicIds.has(id)) globalIssues.push({ level: "warn", msg: `${id}.json has no topic in topics.ts (stale file?)` });
  for (const id of topicIds) if (!fileIds.has(id)) globalIssues.push({ level: "warn", msg: `topic "${id}" has no built puzzle (build failed?)` });
  if (indexIds.size !== index.length) globalIssues.push({ level: "error", msg: "index.json has duplicate ids" });
  for (const m of index) {
    if (!m.title || !m.category) globalIssues.push({ level: "error", msg: `index.json entry "${m.id}" lacks title or category` });
    const file = join(DIR, `${m.id}.json`);
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).title !== m.title) {
      globalIssues.push({ level: "error", msg: `index.json title for "${m.id}" differs from the puzzle's` });
    }
  }

  let errors = 0;
  let warnings = 0;
  const print = (label: string, issues: Issue[]) => {
    if (!issues.length) return;
    console.log(`\n${label}`);
    for (const i of issues) {
      console.log(`  ${i.level === "error" ? "ERROR" : "warn "} ${i.msg}`);
      if (i.level === "error") errors++;
      else warnings++;
    }
  };

  print("index", globalIssues);

  // The facts as written, before a build ships them: an em dash or a missing source fails here first.
  const factFiles: Issue[] = [];
  for (const f of existsSync(FACTS_DIR) ? readdirSync(FACTS_DIR).filter((x) => x.endsWith(".json")).sort() : []) {
    let facts: Record<string, { text?: string; source?: string }>;
    try {
      facts = JSON.parse(readFileSync(join(FACTS_DIR, f), "utf8"));
    } catch (e) {
      factFiles.push({ level: "error", msg: `${f}: unreadable: ${(e as Error).message}` });
      continue;
    }
    for (const [name, fact] of Object.entries(facts)) for (const msg of factIssues(`${f} "${name}"`, fact)) factFiles.push({ level: "error", msg });
  }
  print("scripts/facts", factFiles);

  const sizes: [string, number][] = [];
  const shares: [string, ReturnType<typeof figureShare>][] = [];
  for (const f of files.sort()) {
    let p: Puzzle;
    try {
      p = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    } catch (e) {
      print(f, [{ level: "error", msg: `unreadable: ${(e as Error).message}` }]);
      continue;
    }
    sizes.push([p.id, p.answers.length + p.extras.length]);
    shares.push([p.id, figureShare(p)]);
    print(`${p.id} (${p.answers.length + p.extras.length} accepted)`, checkPuzzle(p, f));
  }

  // Short rankings: how many misses outside the ranking can show a figure.
  console.log(`\nRankings of ${SHORT_RANKING} or fewer: unranked answers with a figure`);
  for (const [id, s] of shares.filter(([, s]) => s.ranked <= SHORT_RANKING && s.unranked)) {
    const pct = Math.round((100 * s.withValue) / s.unranked);
    const why = TOPICS.find((t) => t.id === id)?.noFigures;
    console.log(`  ${id.padEnd(22)} ranked ${String(s.ranked).padStart(2)}, ${s.withValue}/${s.unranked} (${pct}%)${why ? `; none: ${why}` : ""}`);
  }

  sizes.sort((a, b) => a[1] - b[1]);
  console.log(`\n${files.length} puzzles, ${index.length} in index. Smallest: ${sizes.slice(0, 5).map(([id, n]) => `${id} ${n}`).join(", ")}`);
  console.log(`${errors} error(s), ${warnings} warning(s)`);
  return errors ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
