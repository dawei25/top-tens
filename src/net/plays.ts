import { blitzScore, type BlitzState } from "../game/blitz";
import type { GameState } from "../game/state";

/**
 * One finished game as the stats server gets it: no names, no emails, nothing personal. The same checks run again
 * in the database (submit_play in supabase/migrations), so keep the two in step.
 */
export interface Play {
  listId: string;
  mode: "list" | "blitz";
  /** List: answers found, 0-10. Blitz: points, 0-5000. */
  score: number;
  /** Answers found (lists: the same as score). */
  found: number;
  /** Epoch ms the game started; with the list and mode, it names the game (duplicates are ignored). */
  startedAt: number;
  /** YYYY-MM-DD when this was that day's daily, played on its day; otherwise null. */
  daily: string | null;
}

export const LIST_ID = /^[a-z0-9-]{1,64}$/;
export const MAX_LIST_SCORE = 10;
export const MAX_BLITZ_SCORE = 5000;
export const MAX_BLITZ_FOUND = 1000;
/** The server only takes games that started within the last day... */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** ...and not in the future (a little slack for clocks that run fast). */
export const CLOCK_SLACK_MS = 5 * 60 * 1000;

const isInt = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

/** Days since the epoch for a YYYY-MM-DD date, or NaN. */
function dayIndex(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  // Reject dates that roll over (2026-02-31).
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return NaN;
  return t / 86_400_000;
}

/** Why the server would refuse this play, or null if it's fine. `margin` shrinks the age window for queued plays. */
export function invalidPlay(p: Play, now = Date.now(), margin = 0): string | null {
  if (typeof p.listId !== "string" || !LIST_ID.test(p.listId)) return "list id";
  if (p.mode !== "list" && p.mode !== "blitz") return "mode";
  if (p.mode === "list") {
    if (!isInt(p.score, 0, MAX_LIST_SCORE)) return "score";
    if (!isInt(p.found, 0, MAX_LIST_SCORE)) return "found";
  } else {
    if (!isInt(p.score, 0, MAX_BLITZ_SCORE)) return "score";
    if (!isInt(p.found, 0, MAX_BLITZ_FOUND)) return "found";
  }
  if (!Number.isFinite(p.startedAt) || p.startedAt > now + CLOCK_SLACK_MS || p.startedAt < now - MAX_AGE_MS + margin) {
    return "started at";
  }
  if (p.daily !== null) {
    const d = typeof p.daily === "string" ? dayIndex(p.daily) : NaN;
    if (!(Math.abs(d - Math.floor(now / 86_400_000)) <= 1)) return "daily date";
  }
  return null;
}

/** A finished list game as a play; null for games still going or saved before games had a start time. */
export function listPlay(game: GameState, daily?: string): Play | null {
  if (game.status === "playing" || !game.startedAt) return null;
  const found = game.found.length;
  return { listId: game.puzzleId, mode: "list", score: found, found, startedAt: game.startedAt, daily: daily ?? null };
}

/** A finished Blitz round as a play (its start time names it, as in the round's history). */
export function blitzPlay(state: BlitzState, daily?: string): Play | null {
  const startedAt = state.startedAt ?? state.endedAt;
  if (!state.endedAt || !startedAt) return null;
  return {
    listId: state.puzzleId,
    mode: "blitz",
    score: blitzScore(state),
    found: state.hits.length,
    startedAt,
    daily: daily ?? null,
  };
}

/** The identity of a play, as the server's unique key sees it (with the client id). */
export function playKey(p: Pick<Play, "listId" | "mode" | "startedAt">): string {
  return `${p.mode}:${p.listId}:${p.startedAt}`;
}

/** The arguments of the submit_play database function. */
export function rpcArgs(p: Play, clientId: string) {
  return {
    p_list_id: p.listId,
    p_mode: p.mode,
    p_score: p.score,
    p_found: p.found,
    p_client_id: clientId,
    p_started_at: new Date(p.startedAt).toISOString(),
    p_daily_date: p.daily,
  };
}

const CLIENT_KEY = "top-tens:client-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let fallbackId: string | undefined;

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Insecure contexts (plain http off localhost) lack randomUUID; getRandomValues is always there.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * This browser's random id: only there so the same game isn't counted twice. Its own storage key, never synced.
 * Without storage it lasts for the page's lifetime.
 */
export function clientId(storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage): string {
  try {
    const id = storage?.getItem(CLIENT_KEY);
    if (id && UUID.test(id)) return id;
    const fresh = uuid();
    storage?.setItem(CLIENT_KEY, fresh);
    if (storage?.getItem(CLIENT_KEY) === fresh) return fresh;
  } catch {
    // Private mode or storage blocked.
  }
  return (fallbackId ??= uuid());
}
