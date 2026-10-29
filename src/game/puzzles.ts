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

export function randomPuzzleId(index: PuzzleMeta[], played: Set<string>, category?: string): string {
  let pool = index.filter((p) => !category || p.category === category);
  const fresh = pool.filter((p) => !played.has(p.id));
  if (fresh.length) pool = fresh;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
