import { accountsOn, BACKEND } from "../../net/config";

/**
 * The free-play wall's plumbing (the sheet itself is ./FreePlayWall): whether this build has one, and the game the
 * player asked for while it holds that game back.
 *
 * Only a build with accounts that offers Google has the wall (owner, Nov 14: "they have to sign in with google to
 * continue playing"). Without a backend this folds to `false` at build time, like accountsOn, and the wall's code is
 * never shipped on the main path; a stats-only build (VITE_SIGN_IN=none) has nothing to sign in to either.
 */
export const wallOn: boolean = accountsOn && !!BACKEND?.signIn.includes("google");

/**
 * A free-play game the player asked for: a roll (Random list or Random Blitz, from Home, the menu or Roll new list, in a
 * category if one was picked, never landing on `leave`), or Play again on a past run. (A list's results offered its
 * Blitz, an "open" ask, until the owner kept the modes separate, Nov 14: one kept from then reads as no ask.)
 */
export type FreeAsk =
  | { kind: "roll"; mode: "list" | "blitz"; category?: string; leave?: string }
  | { kind: "replay"; mode: "list" | "blitz"; id: string };

/**
 * sessionStorage: the game asked for, kept while a sign-in from the wall leaves the page (a blocked popup takes the tab
 * to Google and back; a build without a Google client ID goes through Supabase's redirect), so it can start once the
 * player is back and signed in. One at a time, 15 minutes at most (as long as a Google try may take).
 */
export const ASK_KEY = "top-tens:free-ask";
export const ASK_TTL = 15 * 60_000;

const MODES = new Set(["list", "blitz"]);
const optStr = (x: unknown) => x === undefined || typeof x === "string";

/** The ask in `raw` if it is one (anything else, from another build or hand-edited, is no ask). */
export function readAsk(raw: unknown, now: number): FreeAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.at !== "number" || now - a.at > ASK_TTL || a.at > now + 60_000 || !MODES.has(a.mode as string)) return null;
  const mode = a.mode as "list" | "blitz";
  if (a.kind === "roll" && optStr(a.category) && optStr(a.leave)) {
    return { kind: "roll", mode, ...(a.category ? { category: a.category as string } : {}), ...(a.leave ? { leave: a.leave as string } : {}) };
  }
  if (a.kind === "replay" && typeof a.id === "string" && /^[\w-]+$/.test(a.id)) return { kind: a.kind, mode, id: a.id };
  return null;
}

/** Keep the ask for a sign-in that may leave the page. */
export function keepAsk(a: FreeAsk, now = Date.now()): void {
  try {
    sessionStorage.setItem(ASK_KEY, JSON.stringify({ ...a, at: now }));
  } catch {
    // No sessionStorage: a popup sign-in still starts the game; only a full-page trip can't.
  }
}

/** The ask kept before the page left, if it's still fresh (read on arrival; `dropAsk` once it's been dealt with). */
export function peekAsk(now = Date.now()): FreeAsk | null {
  try {
    return readAsk(JSON.parse(sessionStorage.getItem(ASK_KEY) ?? "null"), now);
  } catch {
    return null;
  }
}

export function dropAsk(): void {
  try {
    sessionStorage.removeItem(ASK_KEY);
  } catch {
    // Nothing kept.
  }
}
