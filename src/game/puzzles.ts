import type { Lexicon } from "./junk";
import type { Puzzle } from "./types";

export interface PuzzleMeta {
  id: string;
  title: string;
  category: string;
  /** Mirrors Puzzle.blitz, so Blitz can pick a list without downloading each one. */
  blitz?: boolean;
}

const base = import.meta.env.BASE_URL;

export async function loadIndex(): Promise<PuzzleMeta[]> {
  const res = await fetch(`${base}puzzles/index.json`);
  return res.json();
}

export async function loadPuzzle(id: string): Promise<Puzzle> {
  const res = await fetch(`${base}puzzles/${id}.json`);
  if (!res.ok) throw new Error(`Puzzle ${id} not found`);
  return res.json();
}

/** The junk-guess model. Optional: without it, only the simple mash rules apply. */
export async function loadLexicon(): Promise<Lexicon | undefined> {
  try {
    const res = await fetch(`${base}puzzles/lexicon.json`);
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Days since 2026-01-01 in the player's local time zone. */
export function dayNumber(d = new Date()): number {
  const start = new Date(2026, 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

/** Deterministic shuffle position so the daily rotation doesn't follow catalog order. */
export function dailyPuzzleId(index: PuzzleMeta[], day = dayNumber()): string {
  const sorted = [...index].sort((a, b) => hash(a.id) - hash(b.id));
  return sorted[((day % sorted.length) + sorted.length) % sorted.length].id;
}

/** Recent random picks, per kind of roll, so rolling again never repeats the last few. */
const recentRolls: Record<string, string[]> = {};

/**
 * A uniformly random pick from `ids` that avoids the most recent picks of the same `kind` (up to half the pool, so
 * small pools still rotate). Remembered for the page's lifetime.
 */
export function pickRandom(ids: string[], kind: string, rand = Math.random): string | undefined {
  if (!ids.length) return undefined;
  const recent = recentRolls[kind] ?? [];
  const avoid = new Set(recent.slice(0, Math.floor(ids.length / 2)));
  const pool = ids.filter((id) => !avoid.has(id));
  const pick = (pool.length ? pool : ids)[Math.floor(rand() * (pool.length || ids.length))];
  recentRolls[kind] = [pick, ...recent.filter((id) => id !== pick)].slice(0, 20);
  return pick;
}

/**
 * A random list to play, optionally within a category, never one of the last few rolled. `exclude` (today's and
 * future dailies, the list on screen) is skipped unless nothing else is left.
 */
export function randomPuzzleId(index: PuzzleMeta[], category?: string, exclude: ReadonlySet<string> = new Set()): string {
  const ids = index.filter((p) => !category || p.category === category).map((p) => p.id);
  const open = ids.filter((id) => !exclude.has(id));
  return pickRandom(open.length ? open : ids, `roll:${category ?? ""}`) ?? index[0].id;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
