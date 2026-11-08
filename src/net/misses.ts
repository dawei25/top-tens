import type { BlitzResult } from "../game/blitz";
import type { GuessResult } from "../game/types";
import type { OutboxKind } from "./outbox";
import { clientId, LIST_ID } from "./plays";
import type { RatingMode } from "./ratings";
import { KEYS } from "./store";

/**
 * Guesses the game didn't take on a list or a Blitz round, as short lowercase text linked to nobody, so the
 * improvement loop (docs/IMPROVE.md, step 0) fixes the most common misses: an alias, a missing answer, a better line,
 * a false "That doesn't look like an answer". Only in a build with a backend: sent to submit_miss
 * (supabase/migrations/20261108120000_missed_guesses.sql), never kept in the save or synced. Never an accepted
 * answer, a near miss, a "did you mean" choice, or anything from Fathom. The database checks and normalizes the same
 * way, with the same patterns, so keep the two in step (misses.test.ts compares them).
 */

/** The longest miss, in characters (the database counts characters too). */
export const MAX_MISS = 40;

/** unknown: not an answer on this list. junk: doesn't look like an answer at all (kept, to find false junk calls). */
export type MissKind = "unknown" | "junk";

export interface Miss {
  listId: string;
  mode: RatingMode;
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
  if (m.mode !== "list" && m.mode !== "blitz") return "mode";
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
  if (r.kind === "unknown") return r.junk ? "junk" : "unknown";
  if (r.kind === "none" && !r.elsewhere && !r.unscored) return r.junk ? "junk" : "unknown";
  return null;
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
