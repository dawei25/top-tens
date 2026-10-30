// Alias hygiene: which Wikipedia redirects (and table-derived short forms) are not names a player would type for
// the thing. Used by build.ts when collecting aliases and by validate.ts to flag what slipped through.
//
// Missing aliases are free for the player; a removed real nickname hurts recognition. So every rule here has a
// guard: a word the entry's own names use is never evidence against an alias.
import { createRequire } from "node:module";
import { normalize } from "../src/game/match";

const require = createRequire(import.meta.url);

/** The names an entry is known by: its name, its article title, aliases from its table row. */
export interface AliasContext {
  names: string[];
  /**
   * Other forms of the same thing (redirect titles), used to recognize "Topography of the UK" as being about the
   * United Kingdom. Never used as evidence that an alias is a real name.
   */
  forms?: string[];
  /** A creative work (book, show, film, album, game): redirects that share no word with its names are songs or characters. */
  works?: boolean;
}

/** Text without a trailing "(qualifier)": "City (Alaska)" → "City". */
export function baseTitle(title: string): string {
  return title.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

const STOP = new Set("the a an of and in on at to for by with from is it my your you me i we or".split(" "));

/** Normalized words of a name worth comparing: no articles or connectives. */
function words(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}

/** Same word, or one is a misspelling, plural or longer form of the other ("mamma"/"mama", "tetons"/"teton"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // One edit apart.
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const [x, y] = a.length >= b.length ? [a, b] : [b, a];
  return x.slice(i + 1) === y.slice(x.length === y.length ? i + 1 : i);
}

function sharesWord(alias: string, names: string[]): boolean {
  const own = names.flatMap(words);
  return words(alias).some((w) => own.some((o) => sameWord(w, o)));
}

/** "GTA V" for Grand Theft Auto V, "SSBU" for Super Smash Bros. Ultimate: the letters follow the name's initials. */
function isInitialism(alias: string, names: string[]): boolean {
  // "GTAV", "RDRII": a Roman numeral glued to the letters counts as the number.
  const ROMAN_END: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  const a = normalize(alias)
    .replace(/ /g, "")
    .replace(/(?<=[a-z]{2})(viii|vii|vi|iv|ix|iii|ii|i|v|x)$/, (r) => ROMAN_END[r]);
  if (a.length < 2 || a.length > 8 || /\s/.test(alias.trim()) && a.length > 5) return false;
  return names.some((n) => {
    // normalize() drops a leading "The"; an initialism keeps it ("TES V").
    const initials = (/^the\s/i.test(n) ? "t" : "") + normalize(n)
      .split(" ")
      .map((w) => (/^\d+$/.test(w) ? w : w[0]))
      .join("");
    let j = 0;
    for (const c of initials) if (c === a[j]) j++;
    return j === a.length && initials[0] === a[0];
  });
}

/** Parts of a work a redirect can name: "Wonderful (Wicked song)", "Elphaba (character)". */
const WORK_PART = /\b(song|songs|single|character|characters|episode|episodes|chapter|aria|soundtrack|track|number|scene|villain|protagonist)\b/i;

/** Words that make "X of Y" a name of Y rather than an aspect of it: "State of Kuwait", "Republic of the Congo". */
const CLASS_NOUN = new Set(
  (
    "republic kingdom state states commonwealth federation confederation union empire principality emirate sultanate duchy " +
    "province territory dominion realm nation country bailiwick city town village county borough municipality " +
    "prefecture region desert lake mount river sea gulf bay cape peninsula island isle archipelago museum gallery " +
    "tower palace castle cathedral temple church university bank field stadium arena"
  ).split(" "),
);

/** "<aspect> of/in <the thing>": the connecting words. */
const CONNECTOR = /\s(of|in|involving|during|under|for|on|at|against|from|about)\s(the\s)?/gi;

/**
 * Words naming an event, a part, a document or a topic rather than the thing itself: "1937 Nanga Parbat tragedy",
 * "Yellowstone Act", "Southeast ridge", "Makalu Base Camp", "Irish politics". Only evidence when none of the
 * entry's own names uses the word.
 */
const TOPIC_WORDS = new Set(
  (
    "act acts tragedy disaster accident incident expedition expeditions hearing hearings timeline history climate " +
    "archive archives ridge spur route camp campground circuit trek pass byway hole ecosystem wilderness massacre attack " +
    "bombing crash avalanche riot riots protest protests scandal lawsuit lawsuits trial battle campaign election " +
    "referendum economy factsheet slogan mansion department ministry politics origin information symbols heritage " +
    "bibliography infrastructure topography wildfire wildfires establishment foundation fund advisors review " +
    "trends revolution census statistics art band wildlife animals fauna flora"
  ).split(" "),
);
/** Multi-word topic phrases. */
const TOPIC_PHRASES = /\b(metropolitan areas?|base camp|fact sheet|cultural influence|science and technology)\b/i;

/** A description, not a name: "Highest mountain in Asia", "Largest US state", "First trillionaire". */
const DESCRIPTION = /^(the )?(highest|tallest|largest|biggest|longest|richest|deepest|busiest|oldest|most|first|world's|worlds)\b/i;

/** A year: an event or an edition ("1937 Nanga Parbat tragedy", "Glacier National Park Act of 1914"). */
const YEAR = /\b(1[6-9]\d\d|20\d\d)\b/;

/**
 * Why a redirect title (as Wikipedia has it, qualifier included) is not a name for the entry, or null if it may be.
 */
export function junkRedirect(raw: string, ctx: AliasContext): string | null {
  const base = baseTitle(raw);
  const names = ctx.names.filter(Boolean);
  const own = new Set(names.map(normalize));
  if (own.has(normalize(base))) return null;
  const forms = new Set([...names, ...(ctx.forms ?? []).map(baseTitle)].map(normalize).filter(Boolean));
  const ownWords = new Set(names.flatMap(words));
  const usesOwnWord = (w: string) => [...ownWords].some((o) => sameWord(w, o));

  // "City (Alaska)", "Recording District (Alaska)", "Wonderful (Wicked song)": a part of the thing, named in the qualifier.
  // Only plain words count as a part: "America (United States)" and "Twitter (X)" are names, "City (Alaska)" is not.
  const qualifier = raw.match(/\(([^)]*)\)\s*$/)?.[1];
  if (qualifier && !sharesWord(base, names)) {
    if (WORK_PART.test(qualifier)) return "a song or character";
    const plain = normalize(base).split(" ").every((w) => isEnglishWord(w));
    const named = forms.has(normalize(qualifier)) || own.has(normalize(qualifier));
    if (plain && named && normalize(qualifier).length > 2) return "a part of the thing, not a name for it";
  }

  // "Tale of Two Cities, A", "Musk, Elon": an index sort key.
  const inverted = base.match(/^([^,]+),\s*([^,]+)$/);
  if (inverted && (/^(the|a|an)$/i.test(inverted[2]) || forms.has(normalize(`${inverted[2]} ${inverted[1]}`)))) {
    return "an inverted sort key";
  }

  if (YEAR.test(base) && !names.some((n) => /\d{4}/.test(n))) return "names an event or edition (a year)";

  const first = base.match(DESCRIPTION)?.[2];
  if (first && !usesOwnWord(normalize(first))) return "a description, not a name";

  // "Child abuse in Saudi Arabia", "Law of Iran", "Topography of the UK": about the thing, not a name for it.
  for (const m of base.matchAll(CONNECTOR)) {
    const prefix = base.slice(0, m.index);
    const tail = normalize(base.slice(m.index! + m[0].length));
    if (!prefix || !tail) continue;
    // A name with "of" in it ("The Legend of Zelda") only loses "<x> of <its full name>", never "<x> of <a short form>".
    const fullNames = new Set(names.map(normalize));
    const isAboutIt = names.some((n) => /\s(of|in)\s/i.test(n)) ? fullNames.has(tail) : forms.has(tail);
    if (!isAboutIt) continue;
    // "State of Kuwait", "Saban Field at Bryant–Denny Stadium", "P.R. of China": a name, not an aspect.
    const lastWord = normalize(prefix).split(" ").at(-1) ?? "";
    const abbreviation = /^[A-Z][A-Z.]{0,4}$/.test(prefix.trim().split(/\s+/).at(-1) ?? "");
    if (/^(of|at)$/i.test(m[1]) && (CLASS_NOUN.has(lastWord) || abbreviation)) continue;
    return "about the thing, not a name for it";
  }

  const topic = words(base).find((w) => TOPIC_WORDS.has(w) && !usesOwnWord(w)) ?? base.match(TOPIC_PHRASES)?.[0];
  if (topic && !names.some((n) => normalize(n).includes(normalize(topic)))) return `an event, part or topic ("${topic}")`;

  if (ctx.works && !sharesWord(base, names) && !isInitialism(base, names)) return "shares no word with the work (a song or character?)";
  return null;
}

/**
 * Redirects to country articles that no rule can tell from a name (jokes, people, buildings, events), found by the
 * list judges. Dropped on every list with the countries universe.
 */
export const COUNTRY_JUNK = [
  "Snow Mexico", "Finnishness", "The Land of Chocolate", "Day of the Capital", "Abdullah al-Saleh", "Al Rawda Palace",
];

let english: Set<string> | undefined;

/** Lowercase English words (a dictionary list). */
export function isEnglishWord(word: string): boolean {
  english ??= new Set((require("an-array-of-english-words") as string[]).map((w) => w.toLowerCase()));
  return english.has(word.toLowerCase());
}

/**
 * A one-word short form that means something else on its own: "Salt" from Salt Lake Stadium, "Australia" from
 * Stadium Australia, "South" from South Island. `places` are country and state names. Short words (3 letters or
 * fewer) stay: the matcher only finds a word of a longer name from 4 letters up, so they would be lost entirely.
 */
export function bareWord(alias: string, places: Set<string>): boolean {
  const n = normalize(alias);
  if (!n || n.includes(" ") || n.length <= 3) return false;
  return isEnglishWord(n) || places.has(n);
}

/**
 * Alias text glued from several names without spaces: "Mount EverestSagarmathaChomolungma" is the entry's name
 * with another of its names straight after it, no space between.
 */
export function gluedAlias(alias: string, forms: string[]): boolean {
  const others = forms.filter((f) => f !== alias && f.length >= 3);
  // "LeBronJames" is a handle: one name written without its space.
  const compact = (s: string) => normalize(s).replace(/ /g, "");
  if (others.some((f) => compact(f) === compact(alias))) return false;
  return others.some((f) => {
    if (!alias.startsWith(f) || !/[\p{L}\d]$/u.test(f)) return false;
    const rest = alias.slice(f.length);
    return /^\p{Lu}/u.test(rest) && forms.some((g) => g !== f && g !== alias && g.length >= 2 && rest.startsWith(g));
  });
}
