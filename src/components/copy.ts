import { rankedDepth, shownValue } from "../game/state";
import type { Entry, Puzzle } from "../game/types";

/** A non-breaking space: the words on either side wrap as one. */
const NBSP = String.fromCharCode(160);

/**
 * A plain miss (not junk, not vague, not an answer without a figure): "Not one of the 237 films here." when the puzzle
 * names its noun, otherwise "Not on this list." Short enough for one line of the control card on most lists; a long
 * noun wraps with its "here." rather than leaving it alone on the second line.
 */
export function notOnList(puzzle: Pick<Puzzle, "noun" | "answers" | "extras">): string {
  if (!puzzle.noun) return "Not on this list.";
  const count = puzzle.answers.length + puzzle.extras.length;
  return `Not one of the ${count.toLocaleString("en-US")} ${puzzle.noun}${NBSP}here.`;
}

/** The clue key on an empty row: its tooltip and accessible label; once a letter shows, the next one. */
export const CLUE_LABEL = "Clue: first letter, costs a life";
export const CLUE_NEXT_LABEL = "Clue: next letter, costs a life";
/** The clue's confirm, in the row: the first letter, then each next one. */
export const CLUE_ASK = "first letter? 1 life";
export const CLUE_ASK_NEXT = "next letter? 1 life";

/** What the days-in-a-row count means (Home's record and a daily's results). */
export const STREAK_NOTE = "Days in a row you've finished Today's list.";

/** "No life lost.", wrapping as one piece: onto its own line when the sentence before it fills the first. */
export const NO_LIFE_LOST = ["No", "life", "lost."].join(NBSP);

/** "Lost a life.", the end of every line that costs one, wrapping as one piece. */
export const LIFE_LOST = ["Lost", "a", "life."].join(NBSP);

/**
 * A metric's name mid-sentence ("ranked by length", "scored by skyscrapers (150 m+)"): its first letter lowercased,
 * unless the name starts with an acronym (GDP, US box office, AKC rank), a name (Nobel laureates, McDonald's
 * restaurants) or a run of capitalized words (World Series titles, Ballon d'Or wins). Nothing else changes, so units
 * and acronyms further on stay as written ("population (UN 2025)").
 */
export function metricLabel(metric: string): string {
  const words = metric.replace(/\([^)]*\)/g, " ").split(/[\s,]+/).filter(Boolean);
  const [first = "", second = ""] = words;
  if (!/^[A-Z][a-z]/.test(first) || /[A-Z\d$]/.test(first.slice(1))) return metric;
  if (PROPER.has(first) || /[A-Z]/.test(second)) return metric;
  return metric[0].toLowerCase() + metric.slice(1);
}
/** Names a metric can start with that look like ordinary words. */
const PROPER = new Set(["Nobel", "Similarweb", "Olympic", "Oscar", "Grammy", "Emmy", "Michelin", "Billboard", "Spotify", "Instagram", "Netflix", "Broadway", "Wikipedia"]);

/** A plain figure: "200", "4.112", "400–500". */
const PLAIN = /^\d[\d,.]*(?:[–-]\d[\d,.]*)?$/;
/** A plain figure with its scale: "37 million". */
const SCALED = /^\d[\d,.]*(?:[–-]\d[\d,.]*)?(?: (?:thousand|million|billion|trillion))?$/;
/** Words that end the head of a metric's name: "visitors per year", "litres of beer ...", "accounts using it". */
const JOINS = /^(?:per|a|an|in|of|using|incl\.?)$/i;
const IRREGULAR: Record<string, string> = { people: "person", children: "child", men: "man", women: "woman" };
const plural = (w: string) => w.toLowerCase() in IRREGULAR || (/[a-z]s$/i.test(w) && !/(?:ss|us|is)$/i.test(w));
const singular = (w: string) =>
  IRREGULAR[w.toLowerCase()] ?? (/ies$/.test(w) ? w.slice(0, -3) + "y" : /(?:ches|shes|sses|xes)$/.test(w) ? w.slice(0, -2) : w.slice(0, -1));

/**
 * A metric's unit, from its parenthetical, to fold into a plain figure: "(US$ billions)" makes 357 "$357 billion",
 * "(millions, 2025)" makes 17.4 "17.4 million", "(million km²)" makes 9.0 "9.0 million km²". A year, a source or a
 * qualifier ("(2025)", "(UN 2025)", "(150 m+)") is none.
 */
function unitOf(metric: string): ((v: string) => string) | undefined {
  const inside = /\(([^)]*)\)/.exec(metric)?.[1].split(",")[0].trim();
  const m = inside && /^(?:(US\$|€|£)\s*)?(thousands?|millions?|billions?|trillions?)?(?:\s*(km²|km|m|kg|tonnes))?$/.exec(inside);
  if (!m || !(m[1] || m[2] || m[3])) return undefined;
  const cur = m[1] === "US$" ? "$" : (m[1] ?? "");
  const scale = m[2]?.replace(/s$/, "");
  return (v) => `${cur}${v}${scale ? ` ${scale}` : ""}${m[3] ? ` ${m[3]}` : ""}`;
}

/**
 * What a miss's figure is, as the end of "Tokyo is #11...": the number with what it counts when the list counts
 * things (" with 200 skyscrapers", " with 290 million followers", " with 80.5 L per person per year"), money by its
 * currency (" with $1.2 billion"), and anything else with its column's name (" (height: 8,080 m)"). A note the
 * source gives with the figure ("(2025)") stays at its end.
 */
export function figurePhrase(value: string, metric?: string): string {
  const note = /^(.*\S)\s+\(([^()]*)\)$/.exec(value);
  const [main, aside] = note ? [note[1], note[2]] : [value, ""];
  if (!metric) return ` (${value})`;
  const fold = PLAIN.test(main) ? unitOf(metric) : undefined;
  const figure = fold ? fold(main) : main;
  const name = metric.replace(/\s*\(.*$/, "").replace(/,.*$/, "").trim();
  const words = name.split(/\s+/);
  const cut = words.findIndex((w, i) => i > 0 && JOINS.test(w));
  const head = cut > 0 ? words.slice(0, cut) : words;
  const counted = head.findLastIndex(plural);
  const tail = aside ? ` (${aside})` : "";
  if (/^[$€£]/.test(figure)) return ` with ${figure}${tail}`;
  if (counted >= 0 && SCALED.test(figure)) {
    // One of a thing is singular: "1 Ballon d'Or win".
    const said = main === "1" ? [...words.slice(0, counted), singular(words[counted]), ...words.slice(counted + 1)].join(" ") : name;
    return ` with ${figure} ${metricLabel(said)}${tail}`;
  }
  const last = head[head.length - 1].toLowerCase();
  // The figure already names what it counts ("16 seasons"), or carries a unit the metric spreads over time or space
  // ("80.5 L" of "litres of beer per person per year": "80.5 L per person per year").
  if (counted >= 0 && new RegExp(`\\s${last}$`, "i").test(figure)) return ` with ${figure}${tail}`;
  const per = name.search(/\sper\s/);
  if (counted >= 0 && per > 0 && /^\d[\d,.]*\s\S+$/.test(figure)) return ` with ${figure}${name.slice(per)}${tail}`;
  return ` (${metricLabel(name)}: ${figure}${aside ? `, ${aside}` : ""})`;
}

/**
 * The feedback line for a guess that costs a life (an accepted answer outside the top 10, or a place outside a
 * regional list's region). Every one ends "Lost a life.", and its figure says what it is:
 * "Tokyo is #11 with 200 skyscrapers. Lost a life.", "Japan is #11 (population: 122,690,000). Lost a life.",
 * "São Paulo is outside the top 60. Lost a life.", "Pembroke Welsh Corgi was #10 in 2019. Lost a life."
 */
export function lifeCostLine(entry: Entry, puzzle: Pick<Puzzle, "metric" | "region" | "answers" | "extras">): string {
  const end = ` ${LIFE_LOST}`;
  if (entry.elsewhere && puzzle.region) return `${entry.name} isn't in ${puzzle.region}.${end}`;
  const value = shownValue(entry);
  if (entry.rank) return `${entry.name} is #${entry.rank}${value ? figurePhrase(value, puzzle.metric) : ""}.${end}`;
  // Unranked: a dated rank from another table on the source ("#3 in 2025 ($146 million)"), its plain figure saying what
  // it counts ("#9 in 2020 (2,949,871 vehicles sold)"), or how deep the ranking goes.
  if (value?.startsWith("#")) {
    const dated = /^(.*\()([^()]*)\)$/.exec(value);
    const counted = dated && SCALED.test(dated[2]) && figurePhrase(dated[2], puzzle.metric);
    const said = counted && counted.startsWith(" with ") ? `${dated[1]}${counted.slice(6)})` : value;
    return `${entry.name} was ${said}.${end}`;
  }
  const depth = rankedDepth(puzzle);
  const outside = depth > 10 ? `is outside the top ${depth}` : "isn't in the top 10";
  const figure = value ? figurePhrase(value, puzzle.metric) : "";
  // "John Stockton is outside the top 50, with 19,711 points.", "Lake Tahoe is outside the top 47 (area: 490 km²)."
  return `${entry.name} ${outside}${figure.startsWith(" with") ? `,${figure}` : figure}.${end}`;
}

/**
 * The guess box's hint and the misspelling confirm. Device-neutral: a phone's key says Send or Go, not Enter, so the
 * copy names the guess, not the key.
 */
export const GUESS_HINT = "type a name and guess. typos are free.";
/**
 * The guess box's placeholder. On a phone with the roll box beside the guess panel the box is about 170px (120 at
 * 320), room for ten letters: the short one there.
 */
export const PLACEHOLDER = "type a guess...";
export const PLACEHOLDER_SHORT = "your guess";
/**
 * A new random list (or Blitz list), never this one: the roll box before play and the results' key, one name for the
 * one action (UX 1: not "Play again", which reads as the same list). Short, so the roll box beside a phone's guess
 * panel says it in two lines at a key's letter-spacing (owner, Nov 7: "maybe just say roll new list instead?").
 */
export const ROLL_NEW = "Roll new list";
/** "Dubai? Guess again to confirm.": one line at 390 for most names, the instruction wrapping as one piece. */
export const confirmGuess = (name: string) => `${name}? ${["Guess", "again", "to", "confirm."].join(NBSP)}`;
/** A guess already on the board (or one that already cost a life). */
export const alreadyGuessed = (name: string) => `Already guessed ${name}.`;

/**
 * Under the board once a row there has a fact: a tap (or a click) on its name opens it. Left of GIVE UP, so short
 * enough for one line there at 320px (about 140px). One wording for every device: most players are on phones, a
 * mouse also has the hover look, and a click is a tap to anyone reading it.
 */
export const FACT_CUE = "facts: tap a name.";

/**
 * The list's prompt on the Blitz title card, where the goal is as many as you can:
 * "Name the 10 tallest buildings in the world" -> "Name the tallest buildings in the world".
 */
export function blitzPrompt(prompt: string): string {
  return prompt.replace(/^Name the 10 /, "Name the ");
}

/** The prompt's own frame, which says nothing the title doesn't ("Name the 10 ... in the world"). */
const FRAME = new Set(["name", "the", "10"]);
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(?:in the world|of all time|on earth)\b/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
/**
 * The Blitz title card's prompt, only when it adds words beyond the title: "Name the countries with the most Nobel
 * laureates" under "Countries with the most Nobel laureates" says it twice (with "name as many countries as you can"
 * under it, three times), but "... by passenger traffic (2025)" under "Busiest airports" says more.
 */
export function blitzPromptShown(title: string, prompt: string): string | undefined {
  const said = new Set(wordsOf(title));
  return wordsOf(prompt).some((w) => !said.has(w) && !FRAME.has(w)) ? blitzPrompt(prompt) : undefined;
}

/**
 * How Blitz scores, in words that agree with the numbers (src/game/blitz.ts `points`: #1 scores 100, a smaller number
 * never scores more, and nothing scores under 10; copy.test.ts checks it on every Blitz list). The title card says it
 * after the metric ("scored by length: #1 gets 100, ..."), the results under the score.
 */
export const BLITZ_SCORING = "#1 gets 100, smaller numbers get less, down to 10.";
