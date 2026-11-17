import type { BlitzResult } from "../game/blitz";
import type { NameRead } from "../game/fathom-name";
import { isGiveUp, isJunk, type Lexicon } from "../game/junk";
import type { GuessResult } from "../game/types";
import type { OutboxKind } from "./outbox";
import { clientId, LIST_ID } from "./plays";
import type { ListMode } from "./ratings";
import { KEYS } from "./store";

/**
 * Guesses the game didn't take on a list, a Blitz round or a Fathom name-it round, as short lowercase text linked to
 * nobody, so the improvement loop (docs/IMPROVE.md, step 0) fixes the most common misses: an alias, a missing answer, a
 * better line, a false "That doesn't look like an answer". Only in a build with a backend: sent to submit_miss
 * (supabase/migrations/20261108120000_missed_guesses.sql; Fathom's from 20261117120000_fathom_misses.sql), never kept
 * in the save or synced. Never an accepted answer, a near miss, a "did you mean" choice, or a Fathom number round's
 * guess (those are in fathom_guesses). The database checks and normalizes the same way, with the same patterns, so keep
 * the two in step (misses.test.ts compares them).
 */

/** The longest miss, in characters (the database counts characters too). */
export const MAX_MISS = 40;

/** unknown: not an answer on this list. junk: doesn't look like an answer at all (kept, to find false junk calls). */
export type MissKind = "unknown" | "junk";

/**
 * Where a miss was typed: a list game, a Blitz round, or a Fathom name-it round (the question's id as the list id: the
 * owner, Nov 17, "i guessed rome for a city based question but it wasnt accepted").
 */
export const MISS_MODES = ["list", "blitz", "fathom"] as const;
export type MissMode = ListMode | "fathom";

export interface Miss {
  listId: string;
  mode: MissMode;
  kind: MissKind;
  /** As cleanMiss leaves it: 1 to MAX_MISS characters, nothing that looks like an email, a phone number or a link. */
  text: string;
  /** Epoch ms it was typed. */
  at: number;
}

/**
 * The patterns, written once for both sides: the database uses these very strings (Postgres and JavaScript read them
 * the same way). SPACES: control characters, spaces and the other blanks a keyboard or a paste can bring (no-break,
 * ideographic, thin, zero-width no-break).
 */
export const SPACES = "[\\u0001-\\u0020\\u007f-\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+";
/** Something@something.something. A bare "@cristiano" is not one. */
export const EMAIL = "[^ @]+@[^ @]+\\.[^ @]+";
/** Seven digits or more, with at most two of space ( ) . / - between them. "1984" and "432 park avenue" are not. */
export const PHONE = "[0-9]([ ()./-]{0,2}[0-9]){6,}";
/** A scheme, www., or a domain followed by a path. A bare "google.com" (a website's name) is not one. */
export const LINK = "[a-z][a-z0-9+.-]*://|(^| )www\\.|[a-z0-9-]\\.[a-z]{2,}/";

const spaces = new RegExp(SPACES, "gu");
const personal = [EMAIL, PHONE, LINK].map((p) => new RegExp(p, "u"));

/** A guess as it's sent: lowercase, composed (NFC), every run of blanks one space, trimmed. */
export function cleanMiss(text: string): string {
  return text.toLowerCase().normalize("NFC").replace(spaces, " ").replace(/^ | $/g, "");
}

/** Whether cleaned text looks like an email address, a phone number or a link: never sent. */
export const looksPersonal = (clean: string): boolean => personal.some((p) => p.test(clean));

/** Its length as the database counts it: characters (code points), not UTF-16 units. */
const length = (text: string): number => [...text].length;

/** Why the server would refuse this miss, or null if it's fine. */
export function invalidMiss(m: Miss): string | null {
  if (typeof m?.listId !== "string" || !LIST_ID.test(m.listId)) return "list id";
  if (!(MISS_MODES as readonly unknown[]).includes(m.mode)) return "mode";
  if (m.kind !== "unknown" && m.kind !== "junk") return "kind";
  if (typeof m.text !== "string" || cleanMiss(m.text) !== m.text) return "text";
  const n = length(m.text);
  if (n < 1 || n > MAX_MISS) return "length";
  if (looksPersonal(m.text)) return "personal";
  if (!Number.isFinite(m.at)) return "at";
  return null;
}

/**
 * What a judged guess says about a miss: unknown or junk for a guess the game didn't take (a list's "unknown", a
 * Blitz round's "none" for text that isn't on the list, a vague guess included); null for anything it took or offered:
 * a correct answer, a duplicate, a near miss (a real answer outside the top 10), a "did you mean" choice, and on Blitz
 * a place outside the region or an answer without a figure (both on the list).
 */
export function missKind(r: GuessResult | BlitzResult): MissKind | null {
  // A give-up word ("pass", "idk") is no miss to fix: left out of the feed.
  if ((r.kind === "unknown" || r.kind === "none") && (r as { giveUp?: true }).giveUp) return null;
  if (r.kind === "unknown") return r.junk ? "junk" : "unknown";
  if (r.kind === "none" && !r.elsewhere && !r.unscored) return r.junk ? "junk" : "unknown";
  return null;
}

/**
 * What a name typed on a Fathom name-it round and LOCK IN (or Enter) says about a miss, read as the list game reads a
 * guess: unknown for a name the round doesn't take (not on its list, a thing of another kind, a place no list has, a
 * city it has no figure for, a word several names share, nothing it knows), junk when it doesn't look like an answer at
 * all (the list game's own test, `isJunk`); null for a name it took or offered (an answer, a misspelling put in the box
 * to confirm, names to tap), the question's own yardstick (a name on the list), an empty field, and a way of giving up
 * ("pass", "idk"). The number rounds never come here: their guesses are in fathom_guesses.
 */
export function nameMissKind(read: NameRead, typed: string, lex?: Lexicon): MissKind | null {
  if (isGiveUp(typed)) return null;
  switch (read.kind) {
    case "other":
    case "offList":
    case "unmeasured":
    case "vague":
      return "unknown";
    case "unknown":
      return isJunk(typed, lex) ? "junk" : "unknown";
    default:
      return null;
  }
}

/** Misses in the outbox, named by mode, list and text: the server keeps a browser's text on a list once. */
export const MISSES: OutboxKind<Miss> = {
  key: (m) => `${m.mode}:${m.listId}:${m.text}`,
  invalid: (m) => invalidMiss(m),
};

/** The arguments of the submit_miss database function. */
export function missArgs(m: Miss, id: string) {
  return { p_list_id: m.listId, p_mode: m.mode, p_kind: m.kind, p_text: m.text, p_client_id: id };
}

/**
 * The random id a miss carries, for the server's hourly limit and to count a browser once per text. Its own, never the
 * one plays, ratings, notes and Fathom guesses carry, so a miss can't be joined to a signed-in player's games.
 */
export const missClientId = (storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage): string =>
  clientId(storage, KEYS.missId);
